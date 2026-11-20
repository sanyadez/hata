import { expect, test } from "bun:test";
import { byClock, clashes, freeTime, inTheWay, nextAt, type Timed } from "../src/timetable";

const work = (id: string, time: string, touches: Timed["touches"], over: Partial<Timed> = {}): Timed => ({ id, kind: "backups", time, on: true, href: "", touches, ...over });

test("what gets in each other's way: an update in everything's, apps with apps, disks with disks, another server in nobody's", () => {
  expect(inTheWay({ touches: ["hata"] }, { touches: ["disks"] })).toBe(true);
  expect(inTheWay({ touches: ["apps", "disks"] }, { touches: ["apps"] })).toBe(true);
  expect(inTheWay({ touches: ["apps", "disks"] }, { touches: ["disks"] })).toBe(true);
  expect(inTheWay({ touches: ["apps"] }, { touches: ["disks"] })).toBe(false);
  expect(inTheWay({ touches: ["elsewhere"] }, { touches: ["hata"] })).toBe(false);
});

test("the defaults clash: the update of Hata starts with SnapRAID and half an hour after the images", () => {
  const list = [work("backups", "03:00", ["apps", "disks"]), work("images", "04:30", ["apps"]), work("snapraid", "05:00", ["disks"]), work("update", "05:00", ["hata"])];
  expect(clashes(list)).toEqual([
    { id: "update", with: "images", minutes: 30 },
    { id: "update", with: "snapraid", minutes: 0 },
  ]);
  // the images at 04:30 are no trouble for the disks' work, and the backups were done an hour and a half before
  expect(clashes(list.map((one) => (one.id === "update" ? { ...one, on: false } : one)))).toEqual([]);
});

test("a clash is said by the one that starts later, across midnight too", () => {
  expect(clashes([work("a", "23:50", ["disks"]), work("b", "00:20", ["disks"])])).toEqual([{ id: "b", with: "a", minutes: 30 }]);
  expect(clashes([work("b", "00:20", ["disks"]), work("a", "23:50", ["disks"])])).toEqual([{ id: "b", with: "a", minutes: 30 }]);
  expect(clashes([work("a", "01:00", ["disks"]), work("b", "02:00", ["disks"])])).toEqual([]);
  expect(clashes([work("a", "01:00", ["disks"]), work("b", "01:59", ["disks"])])).toEqual([{ id: "b", with: "a", minutes: 59 }]);
  // weekly ones meet only on their day
  expect(clashes([work("a", "01:00", ["disks"], { weekday: 0 }), work("b", "01:00", ["disks"], { weekday: 3 })])).toEqual([]);
  expect(clashes([work("a", "01:00", ["disks"], { weekday: 0 }), work("b", "01:10", ["disks"])])).toHaveLength(1);
});

test("a free time is the first half-hour step forward where nothing clashes", () => {
  const list = [work("snapraid", "05:00", ["disks"]), work("update", "05:00", ["hata"]), work("backups", "06:30", ["apps", "disks"])];
  // 05:30 and 06:00 are within an hour of SnapRAID or the backups; 07:30 is free of both
  expect(freeTime(list, "update")).toBe("07:30");
  expect(freeTime(list, "nothing")).toBeNull();
});

test("the next run: today while its minute has not passed, else tomorrow; a weekly one on its day", () => {
  const now = new Date(2026, 10, 20, 4, 0); // a Friday
  expect(new Date(nextAt({ time: "05:00" }, now)).getDate()).toBe(20);
  expect(new Date(nextAt({ time: "03:00" }, now)).getDate()).toBe(21);
  expect(new Date(nextAt({ time: "04:00" }, now)).getDate()).toBe(20);
  const sunday = new Date(nextAt({ time: "03:00", weekday: 0 }, now));
  expect([sunday.getDate(), sunday.getDay(), sunday.getHours()]).toEqual([22, 0, 3]);
});

test("in the order of the clock, what is off last", () => {
  expect(byClock([work("c", "23:00", []), work("a", "01:00", [], { on: false }), work("b", "02:00", [])]).map((one) => one.id)).toEqual(["b", "c", "a"]);
});
