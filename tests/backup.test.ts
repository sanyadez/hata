import { expect, test } from "bun:test";
import { appDir } from "../src/apps";
import { expired, nextRun, restorable, withoutNested, type Snapshot } from "../src/backup";

const snap = (id: string, at: number, reason: Snapshot["reason"]): Snapshot => ({ id, app: "a", at, reason, size: 1, paths: [], images: [] });

test("nested paths are stored once", () => {
  expect(withoutNested(["/DATA/AppData/a/config", "/DATA/AppData/a", "/DATA/AppData/ab", "/x", "/x"])).toEqual(["/DATA/AppData/a", "/DATA/AppData/ab", "/x"]);
});

test("a restore may only replace the app's own places", () => {
  expect(restorable(appDir("memos"), "memos")).toBe(true);
  expect(restorable(appDir("other"), "memos")).toBe(false);
  expect(restorable("/DATA/AppData/memos/data", "memos", "/DATA")).toBe(true);
  expect(restorable("/DATA/AppData/", "memos", "/DATA")).toBe(false);
  expect(restorable("/DATA/AppData/../../etc", "memos", "/DATA")).toBe(false);
  expect(restorable("/DATA/Media", "memos", "/DATA")).toBe(false);
  expect(restorable("/var/lib/docker/volumes/memos_data/_data", "memos")).toBe(true);
  expect(restorable("/var/lib/docker/volumes/../../etc/_data", "memos")).toBe(false);
  expect(restorable("/etc", "memos")).toBe(false);
  expect(restorable("/", "memos")).toBe(false);
});

test("retention: scheduled beyond `keep`, pre-update beyond three, manual never", () => {
  const list = [
    snap("m1", 1, "manual"),
    snap("s1", 2, "schedule"),
    snap("s2", 3, "schedule"),
    snap("s3", 4, "schedule"),
    snap("u1", 5, "pre-update"),
    snap("u2", 6, "pre-update"),
    snap("u3", 7, "pre-update"),
    snap("u4", 8, "pre-update"),
  ];
  expect(expired(list, 2).map((s) => s.id).sort()).toEqual(["s1", "u1"]);
  expect(expired(list, 7)).toEqual([expect.objectContaining({ id: "u1" })]);
});

test("the next daily run is today if its time is still ahead, else tomorrow", () => {
  const at = (h: number, m: number) => new Date(2026, 9, 9, h, m, 30);
  expect(nextRun("03:00", at(2, 59)).toString()).toBe(new Date(2026, 9, 9, 3, 0).toString());
  expect(nextRun("03:00", at(3, 0)).toString()).toBe(new Date(2026, 9, 10, 3, 0).toString());
  expect(nextRun("23:30", at(12, 0)).getDate()).toBe(9);
});
