/**
 * The server's power: what the processor draws by the kernel's RAPL counters (sampled with the load),
 * hard disks that stop spinning after a wait of the person's (`hdparm -S`, given again whenever a disk
 * shows up under another name or Hata starts — a disk forgets it when it loses power), and the server shut
 * down at night and woken by its own clock (`rtcwake`). The rules are `power.ts`.
 */
import { accessSync, constants, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { record } from "./activity";
import { AppError, listJobs } from "./apps";
import { backupsRunning } from "./backup";
import { saveSettings, settings } from "./config";
import { connected } from "./disks";
import { installCommand, PATH, run } from "./packages";
import { MinuteSeries, nextOff, readPowerSchedule, SLEEP_MINUTES, standbyValue, stateOf, topZone, totalOf, wakeAfter, watts, type PowerSchedule, type Reading, type Zone } from "./power";
import { arrayBusy } from "./snapraid";

// --- What the processor draws ------------------------------------------------------------------------

const POWERCAP = "/sys/class/powercap";

const readNumber = (path: string): number | null => {
  try {
    const n = Number(readFileSync(path, "utf8").trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
};

let zones: (Zone & { top: boolean })[] | null = null;
const readings = new Map<string, Reading>();
const current = new Map<string, number | null>();
const hour = new MinuteSeries();

/** The RAPL zones of this machine that can be read (only root can, since the counters were found to leak secrets) */
function findZones(): (Zone & { top: boolean })[] {
  let names: string[] = [];
  try {
    names = readdirSync(POWERCAP).filter((n) => /^intel-rapl:\d+(:\d+)?$/.test(n));
  } catch {}
  return names
    .map((id) => {
      const dir = join(POWERCAP, id);
      const name = (() => {
        try {
          return readFileSync(join(dir, "name"), "utf8").trim();
        } catch {
          return id;
        }
      })();
      return { id, name, max: readNumber(join(dir, "max_energy_range_uj")) ?? 2 ** 32, top: topZone({ id }) };
    })
    .filter((z) => readNumber(join(POWERCAP, z.id, "energy_uj")) !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** One more reading of every counter; called with the load, every 5 s */
export function samplePower(now = Date.now()): void {
  zones ??= findZones();
  if (!zones.length) return;
  for (const z of zones) {
    const uj = readNumber(join(POWERCAP, z.id, "energy_uj"));
    const before = readings.get(z.id);
    if (uj === null) continue;
    const reading = { uj, at: now };
    current.set(z.id, before ? watts(before, reading, z.max) : null);
    readings.set(z.id, reading);
  }
  const total = totalOf(zones.map((z) => ({ name: z.name, top: z.top, watts: current.get(z.id) ?? null })));
  if (total !== null) hour.add(total, now);
}

export interface PowerNow {
  /** Watts of every top zone together */
  total: number | null;
  zones: { id: string; name: string; top: boolean; watts: number | null }[];
  /** The last hour by minutes */
  hour: (number | null)[];
}

/** What the processor draws now and over the hour; null — this machine has no counters Hata can read */
export function powerNow(now = Date.now()): PowerNow | null {
  if (!zones?.length) return null;
  const list = zones.map((z) => ({ id: z.id, name: z.name, top: z.top, watts: current.get(z.id) ?? null }));
  const round = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
  return { total: round(totalOf(list)), zones: list.map((z) => ({ ...z, watts: round(z.watts) })), hour: hour.hour(now) };
}

// --- Hard disks that stop spinning ---------------------------------------------------------------------

const hdparm = (): string | null => Bun.which("hdparm", { PATH });
/** What was given to each disk, by serial: `<device> <minutes>` — given again when either changes */
const given = new Map<string, string>();
const failures = new Map<string, string>();
let giving: Promise<void> = Promise.resolve();

/** Gives every hard disk with a wait of the person's its wait, unless it has it already */
export function giveSleep(): Promise<void> {
  giving = giving.then(async () => {
    const bin = hdparm();
    if (!bin) return;
    for (const disk of await connected().catch(() => [])) {
      if (!disk.rotational || !disk.serial) continue;
      const minutes = settings.storage.sleep[disk.serial] ?? 0;
      const key = `${disk.path} ${minutes}`;
      // a disk never set is left as it is: its own firmware's wait is not Hata's to change
      if (given.get(disk.serial) === key || (minutes === 0 && !given.has(disk.serial))) continue;
      const ran = await run([bin, "-S", String(standbyValue(minutes) ?? 0), disk.path], 15_000);
      if (ran.code === 0) {
        given.set(disk.serial, key);
        failures.delete(disk.serial);
      } else failures.set(disk.serial, (ran.err || ran.out).trim().split("\n").pop() ?? "hdparm failed");
    }
  }).catch((e) => console.error("Could not set the disks' sleep:", e instanceof Error ? e.message : e));
  return giving;
}

export const HDPARM = "hdparm";

/** The wait of one hard disk, by its serial number; 0 — it spins until it is told otherwise */
export async function setSleep(serial: unknown, minutes: unknown, by: string): Promise<void> {
  if (typeof minutes !== "number" || !(SLEEP_MINUTES as readonly number[]).includes(minutes)) throw new AppError("power.badSleep");
  const disk = (await connected()).find((d) => d.serial === serial);
  if (!disk) throw new AppError("disk.unknown", 404);
  if (!disk.rotational) throw new AppError("power.notSpinning");
  if (!hdparm()) throw new AppError("power.needsHdparm", 400, { package: HDPARM, install: installCommand(HDPARM) });
  const next = { ...settings.storage.sleep };
  if (minutes) next[disk.serial] = minutes;
  else delete next[disk.serial];
  settings.storage = { ...settings.storage, sleep: next };
  saveSettings();
  await giveSleep();
  const failed = failures.get(disk.serial);
  if (failed) throw new AppError("power.sleepFailed", 400, { message: failed });
  record("disk.sleep", { user: by, detail: `${disk.model || disk.name} ${minutes}` });
}

/** Whether each hard disk spins now — `hdparm -C` asks without waking it — and its wait */
export async function sleepReport(): Promise<{ tool: boolean; install: string; disks: Record<string, { minutes: number; state: "active" | "standby" | null; error: string }> }> {
  const bin = hdparm();
  const disks: Record<string, { minutes: number; state: "active" | "standby" | null; error: string }> = {};
  for (const disk of await connected().catch(() => [])) {
    if (!disk.rotational || !disk.serial) continue;
    const state = bin ? stateOf((await run([bin, "-C", disk.path], 5_000)).out) : null;
    disks[disk.serial] = { minutes: settings.storage.sleep[disk.serial] ?? 0, state, error: failures.get(disk.serial) ?? "" };
  }
  return { tool: !!bin, install: bin ? "" : installCommand(HDPARM), disks };
}

// --- Off at night, on in the morning --------------------------------------------------------------------

const WAKEALARM = "/sys/class/rtc/rtc0/wakealarm";
/** How long a shutdown waits for work that is running, then gives up for that night */
const WAIT_MS = 2 * 3600_000;

/** Whether this machine can be woken by its clock: a clock with an alarm Hata may set */
export function canWake(): "ok" | "noClock" | "notRoot" | "readOnly" {
  if (process.getuid?.() !== 0) return "notRoot";
  if (!existsSync(WAKEALARM)) return "noClock";
  try {
    accessSync(WAKEALARM, constants.W_OK);
  } catch {
    return "readOnly";
  }
  return Bun.which("rtcwake", { PATH }) ? "ok" : "noClock";
}

/** What would be cut by a shutdown now; null — nothing */
async function busyWith(): Promise<string | null> {
  const job = listJobs().find((j) => j.status === "running");
  if (job) return job.kind;
  if (backupsRunning()) return "backups";
  if (arrayBusy()) return "snapraid";
  const copies = await run(["systemctl", "list-units", "hata-copy-*", "--state=active", "--no-legend", "--plain"], 5_000).catch(() => null);
  if (copies?.out.trim()) return "filecopy";
  return null;
}

let waitingSince = 0;
let lastDay = "";

export interface PowerReport {
  schedule: PowerSchedule;
  can: ReturnType<typeof canWake>;
  /** When it shuts down next and wakes after it; null — off */
  next: { off: number; wake: number } | null;
  /** Waiting for running work before shutting down: what, since when */
  waiting: { what: string; since: number } | null;
}

let waitingFor = "";

export function powerReport(now = new Date()): PowerReport {
  const off = nextOff(settings.power, now);
  return { schedule: settings.power, can: canWake(), next: off ? { off: off.getTime(), wake: wakeAfter(settings.power, off).getTime() } : null, waiting: waitingSince ? { what: waitingFor, since: waitingSince } : null };
}

export function setPowerSchedule(data: unknown, by: string): PowerReport {
  const read = readPowerSchedule(data, settings.power);
  if (typeof read === "string") throw new AppError(read);
  if (read.on && canWake() !== "ok") throw new AppError("power.cannot." + canWake());
  const was = settings.power;
  settings.power = read;
  saveSettings();
  waitingSince = 0;
  if (JSON.stringify(was) !== JSON.stringify(read)) record(read.on ? "power.schedule" : "power.scheduleOff", { user: by, detail: read.on ? `${read.off}–${read.wake}` : "" });
  return powerReport();
}

/**
 * Sets the clock's alarm, checks it took, and shuts the server down. A clock that did not take the alarm
 * keeps the server on: one that would not wake again is worse than one that stays up.
 */
async function goDown(wake: Date, by: string, code: string): Promise<void> {
  const epoch = Math.floor(wake.getTime() / 1000);
  const set = await run(["rtcwake", "-m", "no", "-t", String(epoch)], 15_000);
  const alarm = readNumber(WAKEALARM);
  if (set.code !== 0 || !alarm) {
    record("power.failed", { user: by, detail: (set.err || set.out).trim().split("\n").pop() || "the clock took no alarm" });
    throw new AppError("power.alarmFailed", 500, { message: (set.err || set.out).trim().split("\n").pop() ?? "" });
  }
  record(code, { user: by, detail: wake.toISOString() });
  // a moment for the activity line to be written and the page to hear of it
  setTimeout(() => void run(["systemctl", "poweroff"], 30_000), 3_000);
}

/** The check of the person's machine: shut down now and wake in a few minutes */
export async function tryWake(minutes: unknown, by: string): Promise<{ wake: number }> {
  const can = canWake();
  if (can !== "ok") throw new AppError("power.cannot." + can);
  const n = typeof minutes === "number" && Number.isInteger(minutes) && minutes >= 2 && minutes <= 30 ? minutes : 3;
  const busy = await busyWith();
  if (busy) throw new AppError("power.busy", 409, { what: busy });
  const wake = new Date(Date.now() + n * 60_000);
  await goDown(wake, by, "power.test");
  return { wake: wake.getTime() };
}

/** The nightly shutdown when its minute comes, after the work that runs then; and the disks' sleep given again now and then */
export function startPower(): void {
  setTimeout(() => void giveSleep(), 20_000);
  setInterval(() => void giveSleep(), 5 * 60_000);
  setInterval(async () => {
    const s = settings.power;
    const now = new Date();
    if (!s.on) return void (waitingSince = 0);
    const day = now.toDateString();
    if (!waitingSince) {
      const off = nextOff(s, now);
      if (!off || off.getTime() > now.getTime() || lastDay === day) return;
      lastDay = day;
      waitingSince = now.getTime();
    }
    const busy = await busyWith();
    if (busy) {
      if (waitingFor !== busy) record("power.waiting", { user: "schedule", detail: busy });
      waitingFor = busy;
      if (now.getTime() - waitingSince > WAIT_MS) {
        waitingSince = 0;
        record("power.skipped", { user: "schedule", detail: busy });
      }
      return;
    }
    waitingSince = 0;
    waitingFor = "";
    // the wake after this night's shutdown time: a wait for running work moves the shutdown, not the wake
    const off = new Date(now);
    off.setHours(Number(s.off.slice(0, 2)), Number(s.off.slice(3, 5)), 0, 0);
    if (off.getTime() > now.getTime()) off.setDate(off.getDate() - 1);
    const morning = wakeAfter(s, off);
    // the work ran almost until the morning: no shutdown this time
    if (morning.getTime() - Date.now() < 10 * 60_000) return void record("power.skipped", { user: "schedule", detail: "late" });
    await goDown(morning, "schedule", "power.off").catch(() => {});
  }, 20_000);
}
