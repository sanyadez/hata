import { expect, test } from "bun:test";
import { asleep, awake, over } from "../src/snooze";

const item = (severity: "warn" | "danger", at?: number) => ({ id: "smart:X1", severity, code: "smart.reallocated", detail: {}, ...(at ? { at } : {}) });

test("an item put off stays away until its time, unless it gets worse or happens again", () => {
  const entry = { until: 1000, severity: "warn" as const, at: 0 };
  expect(asleep(item("warn"), entry, 500)).toBe(true);
  expect(asleep(item("warn"), entry, 1000)).toBe(false);
  expect(asleep(item("danger"), entry, 500)).toBe(false);
  expect(asleep(item("warn"), undefined, 500)).toBe(false);
  // an event: the same one stays put off, another one (a new `at`) is news
  const event = { until: 1000, severity: "warn" as const, at: 42 };
  expect(asleep(item("warn", 42), event, 500)).toBe(true);
  expect(asleep(item("warn", 43), event, 500)).toBe(false);
  // a danger put off hides a warning of the same thing too
  expect(asleep(item("warn"), { until: 1000, severity: "danger", at: 0 }, 500)).toBe(true);
  expect(awake([item("warn"), { ...item("warn"), id: "other" }], { "smart:X1": entry }, 500).map((i) => i.id)).toEqual(["other"]);
});

test("an item put off for good stays away when it happens again, and comes back only when it gets worse", () => {
  const forever = { until: 0, severity: "warn" as const, at: 42 };
  expect(asleep(item("warn", 42), forever, 10 ** 15)).toBe(true);
  expect(asleep(item("warn", 43), forever, 10 ** 15)).toBe(true);
  expect(asleep(item("warn"), forever, 10 ** 15)).toBe(true);
  expect(asleep(item("danger", 42), forever, 500)).toBe(false);
});

test("hidden for this time: back when it happens again, gets worse, or ends and returns", () => {
  const once = { until: 0, once: true, severity: "warn" as const, at: 5 };
  const item = (severity: "warn" | "danger", at?: number) => ({ id: "x", severity, code: "c", detail: {}, ...(at ? { at } : {}) }) as any;
  expect(asleep(item("warn", 5), once, 1e15)).toBe(true);
  expect(asleep(item("warn", 6), once, 0)).toBe(false);
  expect(asleep(item("danger", 5), once, 0)).toBe(false);
  // a state has no `at`: hidden while it lasts, forgotten once it is over
  const state = { until: 0, once: true, severity: "warn" as const, at: 0 };
  expect(asleep(item("warn"), state, 0)).toBe(true);
  expect(over({ x: state, y: { until: 0, severity: "warn", at: 0 } }, [])).toEqual(["x"]);
  expect(over({ x: state }, [item("warn")])).toEqual([]);
});
