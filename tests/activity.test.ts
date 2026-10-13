import { expect, test } from "bun:test";
import { history, record, recent } from "../src/activity";

test("history: the log in pages, newest first, each older than the one before", async () => {
  for (let i = 0; i < 5; i++) {
    record("test.history", { detail: String(i) });
    await Bun.sleep(2);
  }
  const first = history(Date.now() + 1000, 2);
  expect(first.entries.map((e) => e.detail)).toEqual(["4", "3"]);
  expect(first.more).toBe(true);
  const next = history(first.entries[1]!.ts, 2);
  expect(next.entries.map((e) => e.detail)).toEqual(["2", "1"]);
  expect(history(0, 2).entries.map((e) => e.detail)).toEqual(["4", "3"]);
  expect(recent(1)[0]!.detail).toBe("4");
});
