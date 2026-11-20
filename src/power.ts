/**
 * The server's power, the pure part: what the processor draws (RAPL counters of the kernel), how long a
 * hard disk waits idle before it stops spinning (`hdparm -S`), and the times the server switches itself
 * off and wakes by its clock (`rtcwake`). The state and the programs are `powering.ts`.
 */

// --- What the processor draws ------------------------------------------------------------------------

/** A zone of `/sys/class/powercap`: `package-0`, `core`, `dram`, `uncore`, `psys` */
export interface Zone {
  /** `intel-rapl:0`, `intel-rapl:0:1` */
  id: string;
  name: string;
  /** Where the counter wraps round, µJ */
  max: number;
}

/** A counter read: µJ at a moment (ms) */
export interface Reading {
  uj: number;
  at: number;
}

/**
 * Watts between two readings of one counter; it wraps at `max`. Null — no time passed, or a reading
 * that cannot be (a counter that went back by more than a wrap would explain).
 */
export function watts(before: Reading, after: Reading, max: number): number | null {
  const ms = after.at - before.at;
  if (ms <= 0) return null;
  let uj = after.uj - before.uj;
  if (uj < 0) uj += max;
  if (uj < 0 || uj > max) return null;
  return uj / 1000 / ms;
}

/** The zones worth showing: the top ones (each socket's package, the whole platform) and their parts */
export const topZone = (zone: Pick<Zone, "id">): boolean => /^intel-rapl:\d+$/.test(zone.id);

/**
 * The draw of the server as the counters know it: every package with the memory (a `dram` zone is counted
 * apart from its package, though it is listed under it); `psys`, when there, already holds all of it.
 */
export function totalOf(zones: { name: string; top: boolean; watts: number | null }[]): number | null {
  const counted = zones.filter((z) => (z.top || z.name === "dram") && z.watts !== null);
  if (!counted.some((z) => z.top)) return null;
  const platform = counted.find((z) => z.name === "psys");
  return platform ? platform.watts : counted.reduce((sum, z) => sum + z.watts!, 0);
}

/** An hour by minutes: each minute's average, the last one still filling */
export class MinuteSeries {
  private minutes: { start: number; sum: number; n: number }[] = [];

  add(value: number, now: number): void {
    const start = Math.floor(now / 60_000) * 60_000;
    const last = this.minutes[this.minutes.length - 1];
    if (last && last.start === start) {
      last.sum += value;
      last.n++;
    } else this.minutes.push({ start, sum: value, n: 1 });
    this.minutes = this.minutes.filter((m) => now - m.start < 60 * 60_000);
  }

  /** The last hour's whole minutes, oldest first; a minute with no reading is null */
  hour(now: number): (number | null)[] {
    const end = Math.floor(now / 60_000) * 60_000;
    const out: (number | null)[] = [];
    for (let at = end - 60 * 60_000; at < end; at += 60_000) {
      const m = this.minutes.find((one) => one.start === at);
      out.push(m ? Math.round((m.sum / m.n) * 10) / 10 : null);
    }
    return out;
  }
}

// --- A hard disk that stops spinning -------------------------------------------------------------------

/** The waits a person may choose, minutes; 0 — never */
export const SLEEP_MINUTES = [0, 10, 20, 30, 60, 120, 240] as const;

/**
 * `hdparm -S` for a wait: 1–240 count 5 s each (up to 20 min), 241–251 count 30 min each (up to 5.5 h);
 * 0 turns it off. Null — a wait it cannot say.
 */
export function standbyValue(minutes: number): number | null {
  if (minutes === 0) return 0;
  if (!Number.isInteger(minutes) || minutes < 0) return null;
  if (minutes <= 20) return minutes * 12;
  if (minutes % 30 === 0 && minutes <= 330) return 240 + minutes / 30;
  return null;
}

/** The waits of the settings, checked: serial → minutes; an unknown wait drops out */
export function cleanSleep(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
  for (const [serial, minutes] of Object.entries(value).slice(0, 64)) {
    if (/^[\w .:-]{1,64}$/.test(serial) && typeof minutes === "number" && (SLEEP_MINUTES as readonly number[]).includes(minutes) && minutes > 0) out[serial] = minutes;
  }
  return out;
}

/** What `hdparm -C` says of a disk: spinning, asleep, or not known */
export function stateOf(out: string): "active" | "standby" | null {
  const m = /drive state is:\s*(.+)/i.exec(out);
  if (!m) return null;
  const said = m[1]!.trim().toLowerCase();
  if (said.startsWith("standby") || said.startsWith("sleeping")) return "standby";
  if (said.startsWith("active") || said.startsWith("idle")) return "active";
  return null;
}

// --- Off and on by the clock ---------------------------------------------------------------------------

export interface PowerSchedule {
  on: boolean;
  /** HH:MM local: the server shuts down */
  off: string;
  /** HH:MM local: it wakes by its clock */
  wake: string;
  /** The days it shuts down on, 0 — Sunday; it wakes at the next `wake` after that */
  days: number[];
}

export const POWER_DEFAULTS: PowerSchedule = { on: false, off: "01:00", wake: "07:00", days: [0, 1, 2, 3, 4, 5, 6] };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A schedule as the page sent it; a string — the error code */
export function readPowerSchedule(data: unknown, was: PowerSchedule = POWER_DEFAULTS): PowerSchedule | string {
  if (typeof data !== "object" || data === null) return "power.bad";
  const d = data as Record<string, unknown>;
  const off = d.off === undefined ? was.off : d.off;
  const wake = d.wake === undefined ? was.wake : d.wake;
  if (typeof off !== "string" || !TIME_RE.test(off) || typeof wake !== "string" || !TIME_RE.test(wake)) return "power.badTime";
  if (off === wake) return "power.sameTime";
  const days = d.days === undefined ? was.days : d.days;
  if (!Array.isArray(days) || days.some((n) => !Number.isInteger(n) || n < 0 || n > 6)) return "power.badDays";
  const on = d.on === undefined ? was.on : d.on === true;
  if (on && !days.length) return "power.noDays";
  return { on, off, wake, days: [...new Set(days as number[])].sort() };
}

const at = (day: Date, time: string): Date => {
  const d = new Date(day);
  d.setHours(Number(time.slice(0, 2)), Number(time.slice(3, 5)), 0, 0);
  return d;
};

/** When the server shuts down next (a day of the list, the minute not passed yet); null — never */
export function nextOff(s: PowerSchedule, now: Date): Date | null {
  if (!s.on || !s.days.length) return null;
  for (let i = 0; i < 8; i++) {
    const day = new Date(now);
    day.setDate(day.getDate() + i);
    const when = at(day, s.off);
    if (s.days.includes(when.getDay()) && when.getTime() + 60_000 > now.getTime()) return when;
  }
  return null;
}

/** When it wakes after shutting down at `off`: the first `wake` after it (the same night or the next morning) */
export function wakeAfter(s: PowerSchedule, off: Date): Date {
  let when = at(off, s.wake);
  if (when.getTime() <= off.getTime()) {
    when = new Date(when);
    when.setDate(when.getDate() + 1);
    when = at(when, s.wake);
  }
  return when;
}

/** How long it is off, minutes */
export const offFor = (s: PowerSchedule): number => {
  const [o, w] = [s.off, s.wake].map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)));
  return (w! - o! + 1440) % 1440;
};
