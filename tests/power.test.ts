import { expect, test } from "bun:test";
import { cleanSleep, MinuteSeries, nextOff, offFor, readPowerSchedule, standbyValue, stateOf, topZone, totalOf, wakeAfter, watts, POWER_DEFAULTS } from "../src/power";
import { whileOff, type Timed } from "../src/timetable";

test("watts from two readings of a counter, across its wrap", () => {
  expect(watts({ uj: 1_000_000, at: 0 }, { uj: 6_000_000, at: 1000 }, 2 ** 32)).toBe(5);
  // the counter wrapped: 1 J before the wrap and 4 J after it
  expect(watts({ uj: 9_000_000, at: 0 }, { uj: 4_000_000, at: 1000 }, 10_000_000)).toBe(5);
  expect(watts({ uj: 1, at: 1000 }, { uj: 2, at: 1000 }, 100)).toBeNull();
});

test("the server's draw: the platform's zone when there is one, else every package together", () => {
  expect(totalOf([{ name: "package-0", top: true, watts: 6 }, { name: "core", top: false, watts: 3 }, { name: "package-1", top: true, watts: 4 }])).toBe(10);
  expect(totalOf([{ name: "package-0", top: true, watts: 6 }, { name: "psys", top: true, watts: 15 }])).toBe(15);
  expect(totalOf([{ name: "core", top: false, watts: 3 }])).toBeNull();
  // the memory is counted apart from the package it is listed under
  expect(totalOf([{ name: "package-0", top: true, watts: 1.6 }, { name: "core", top: false, watts: 0.3 }, { name: "dram", top: false, watts: 0.8 }])).toBeCloseTo(2.4);
  expect(topZone({ id: "intel-rapl:0" })).toBe(true);
  expect(topZone({ id: "intel-rapl:0:1" })).toBe(false);
});

test("an hour by minutes: averages, an empty minute is null", () => {
  const s = new MinuteSeries();
  const base = 10 * 3600_000;
  s.add(4, base + 1000);
  s.add(6, base + 30_000);
  s.add(8, base + 120_000);
  const hour = s.hour(base + 180_000);
  expect(hour).toHaveLength(60);
  expect(hour.slice(-3)).toEqual([5, null, 8]);
});

test("hdparm -S: 5 s steps up to 20 min, then half hours", () => {
  expect(standbyValue(0)).toBe(0);
  expect(standbyValue(10)).toBe(120);
  expect(standbyValue(20)).toBe(240);
  expect(standbyValue(30)).toBe(241);
  expect(standbyValue(60)).toBe(242);
  expect(standbyValue(240)).toBe(248);
  expect(standbyValue(45)).toBeNull();
  expect(cleanSleep({ ABC123: 20, X: 45, "bad/serial": 10, Z: 0 })).toEqual({ ABC123: 20 });
  expect(stateOf("\n/dev/sdb:\n drive state is:  standby\n")).toBe("standby");
  expect(stateOf("\n/dev/sdb:\n drive state is:  active/idle\n")).toBe("active");
  expect(stateOf("/dev/sdc:\n drive state is:  unknown\n")).toBeNull();
});

test("a schedule of the nights: checked, and its next shutdown and wake", () => {
  expect(readPowerSchedule({ off: "25:00" })).toBe("power.badTime");
  expect(readPowerSchedule({ off: "07:00", wake: "07:00" })).toBe("power.sameTime");
  expect(readPowerSchedule({ on: true, days: [] })).toBe("power.noDays");
  const s = readPowerSchedule({ on: true, off: "23:30", wake: "07:00", days: [5, 1, 1] });
  expect(s).toEqual({ on: true, off: "23:30", wake: "07:00", days: [1, 5] });
  const sched = s as Exclude<typeof s, string>;
  const friday = new Date(2026, 10, 20, 12, 0);
  const off = nextOff(sched, friday)!;
  expect([off.getDate(), off.getHours(), off.getMinutes()]).toEqual([20, 23, 30]);
  const wake = wakeAfter(sched, off);
  expect([wake.getDate(), wake.getHours()]).toEqual([21, 7]);
  // past Friday's time: the next is Monday
  expect(nextOff(sched, new Date(2026, 10, 20, 23, 40))!.getDate()).toBe(23);
  expect(nextOff({ ...sched, on: false }, friday)).toBeNull();
  expect(offFor(sched)).toBe(450);
  // shut down after midnight: it wakes the same morning
  const early = wakeAfter({ ...POWER_DEFAULTS, off: "01:00", wake: "07:00" }, new Date(2026, 10, 21, 1, 0));
  expect([early.getDate(), early.getHours()]).toEqual([21, 7]);
});

test("work whose time falls while the server is off does not run", () => {
  const work = (id: string, time: string, over: Partial<Timed> = {}): Timed => ({ id, kind: "backups", time, on: true, href: "", touches: ["disks"], ...over });
  const list = [work("backups", "03:00"), work("snapraid", "08:00"), work("pve:1", "02:00", { touches: ["elsewhere"] }), work("images", "23:45"), work("off", "04:00", { on: false }), work("power", "23:30", { kind: "power", touches: ["hata"] })];
  expect(whileOff(list, "23:30", "07:00")).toEqual(["backups", "images"]);
});
