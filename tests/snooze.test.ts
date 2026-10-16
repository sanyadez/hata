import { expect, test } from "bun:test";
import { asleep, awake } from "../src/snooze";

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
