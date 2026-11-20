/**
 * What Hata starts by itself and when, as one list: the work that runs at a time the person chose (the
 * backups, the update of Hata and of the images, SnapRAID, the backups of a Proxmox server) and the looks
 * that come round on their own. Pure: `timetable.ts` words nothing and reads no state — the route gathers
 * the inputs. Work started within an hour of other work it gets in the way of is said to clash.
 */

/** What a piece of work does to the server, for telling which ones get in each other's way */
export type Touches = "hata" | "apps" | "disks" | "elsewhere";

export interface Timed {
  /** `backups`, `update`, `images`, `snapraid`, `pve:<id>` */
  id: string;
  kind: "backups" | "update" | "images" | "snapraid" | "proxmox";
  /** HH:MM, local */
  time: string;
  on: boolean;
  /** Only on this day of the week (0 — Sunday); none — every day */
  weekday?: number;
  /** SnapRAID: on Sundays the check of the parity follows the sync */
  scrub?: boolean;
  /** A Proxmox server's name */
  name?: string;
  /** How the last run went; null — not yet, undefined — not known */
  last?: { at: number; ok: boolean } | null;
  /** Where it is set */
  href: string;
  touches: Touches[];
}

export interface Repeating {
  id: string;
  /** How often, ms */
  every: number;
  on: boolean;
  /** When it last ran; null — not yet, undefined — not kept */
  last?: number | null;
  href: string;
}

export interface Clash {
  /** The later of the two (by the clock, from the earlier) */
  id: string;
  /** The one it starts while it may still be running */
  with: string;
  /** Minutes between their starts */
  minutes: number;
}

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** How long a piece of work is taken to run when nothing better is known: starts closer than this clash */
export const WINDOW_MIN = 60;

const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** When a time of the day comes next after `now` (on its weekday only, when it has one) */
export function nextAt(entry: Pick<Timed, "time" | "weekday">, now: Date): number {
  const at = new Date(now);
  at.setHours(Number(entry.time.slice(0, 2)), Number(entry.time.slice(3, 5)), 0, 0);
  // the minute itself still counts: the schedules look every 20 s within it
  if (at.getTime() + 60_000 <= now.getTime()) at.setDate(at.getDate() + 1);
  if (entry.weekday !== undefined) while (at.getDay() !== entry.weekday) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/**
 * Whether two pieces of work get in each other's way: an update restarts Hata and ends whatever it runs;
 * the backups stop apps that the update of images restarts; the backups and SnapRAID read the same disks.
 * What runs on another server never clashes with this one's work.
 */
export function inTheWay(a: Pick<Timed, "touches">, b: Pick<Timed, "touches">): boolean {
  if (a.touches.includes("elsewhere") && a.touches.length === 1) return false;
  if (b.touches.includes("elsewhere") && b.touches.length === 1) return false;
  if (a.touches.includes("hata") || b.touches.includes("hata")) return true;
  return a.touches.some((one) => b.touches.includes(one));
}

/**
 * The pairs of work switched on that start within `window` minutes of each other (across midnight too)
 * and get in each other's way. A weekly one clashes with a daily one, and with another weekly one only on
 * the same day. Each pair is said once, by the one that starts later.
 */
export function clashes(list: Timed[], window = WINDOW_MIN): Clash[] {
  const on = list.filter((one) => one.on && TIME_RE.test(one.time));
  const found: Clash[] = [];
  for (let i = 0; i < on.length; i++) {
    for (let j = i + 1; j < on.length; j++) {
      const [a, b] = [on[i]!, on[j]!];
      if (a.weekday !== undefined && b.weekday !== undefined && a.weekday !== b.weekday) continue;
      if (!inTheWay(a, b)) continue;
      const ahead = (minutesOf(b.time) - minutesOf(a.time) + 1440) % 1440;
      const back = (1440 - ahead) % 1440;
      // the one that starts later is the one that clashes; the same minute — the second of the list
      if (ahead <= back && ahead < window) found.push({ id: b.id, with: a.id, minutes: ahead });
      else if (back < ahead && back < window) found.push({ id: a.id, with: b.id, minutes: back });
    }
  }
  return found;
}

/** The work at chosen times in the order of the clock, from midnight; what is off goes last */
export const byClock = <T extends Pick<Timed, "time" | "on">>(list: T[]): T[] => [...list].sort((a, b) => Number(b.on) - Number(a.on) || minutesOf(a.time) - minutesOf(b.time));

/** A free time near `time` for `entry`: the first one, going forward in steps of 30 minutes, where nothing clashes */
export function freeTime(list: Timed[], id: string, window = WINDOW_MIN): string | null {
  const entry = list.find((one) => one.id === id);
  if (!entry) return null;
  for (let step = 1; step < 48; step++) {
    const minutes = (minutesOf(entry.time) + step * 30) % 1440;
    const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    const moved = list.map((one) => (one.id === id ? { ...one, time } : one));
    if (!clashes(moved, window).some((c) => c.id === id || c.with === id)) return time;
  }
  return null;
}
