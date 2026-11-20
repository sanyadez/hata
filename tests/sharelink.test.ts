import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alive, expiresAt, kept, KEEP_ENDED, moved, pausedFor, piecesOf, readNewLink, roomInDrop, TRIES, wrongOnce, type ShareLink } from "../src/sharelink";
import { entriesOf, inside } from "../src/sharelinks";

test("a new link: a week by default, a drop only into a folder, a password not too short", () => {
  expect(readNewLink({}, false)).toEqual({ kind: "get", hours: 168, password: "", limit: 0, note: "" });
  expect(readNewLink({ kind: "drop" }, false)).toBe("links.dropNeedsFolder");
  expect(readNewLink({ kind: "drop", limit: 1024, note: "  photos\n of  the day " }, true)).toEqual({ kind: "drop", hours: 168, password: "", limit: 1024, note: "photos of the day" });
  // a limit means nothing for a link to download
  expect(readNewLink({ kind: "get", limit: 1024 }, true)).toMatchObject({ limit: 0 });
  expect(readNewLink({ password: "abc" }, true)).toBe("links.badPassword");
  expect(readNewLink({ hours: -1 }, true)).toBe("links.badTime");
  expect(readNewLink({ hours: 1.5 }, true)).toBe("links.badTime");
  expect(readNewLink({ kind: "rm" }, true)).toBe("links.badKind");
  expect(readNewLink({ hours: 0 }, true)).toMatchObject({ hours: 0 });
});

test("a link works until its time; an ended one is kept a month, then goes", () => {
  expect(expiresAt(0, 1000)).toBe(0);
  expect(expiresAt(2, 1000)).toBe(1000 + 2 * 3600_000);
  expect(alive({ expires: 0 }, 5)).toBe(true);
  expect(alive({ expires: 10 }, 5)).toBe(true);
  expect(alive({ expires: 10 }, 10)).toBe(false);
  expect(kept([{ expires: 0 }, { expires: 10 }, { expires: 20 }], 15 + KEEP_ENDED)).toEqual([{ expires: 0 }, { expires: 20 }]);
});

test("a path inside a link: pieces only, nothing above, nothing hidden of Hata's", () => {
  expect(piecesOf("")).toEqual([]);
  expect(piecesOf(null)).toEqual([]);
  expect(piecesOf("trip/day 1/a.jpg")).toEqual(["trip", "day 1", "a.jpg"]);
  for (const bad of ["..", "a/../b", "/etc", "a//b", "a/", "./a", ".hata-upload-abcdefgh", "a/.hata-trash/x", "a\\b", "a\0b", 7]) expect(piecesOf(bad)).toBeNull();
});

test("links follow a moved folder and go with a removed one", () => {
  const links = [{ path: "/DATA/Photos" }, { path: "/DATA/Photos/2026/a.jpg" }, { path: "/DATA/Photos2" }];
  expect(moved(links, "/DATA/Photos", "/DATA/Pictures").map((l) => l.path)).toEqual(["/DATA/Pictures", "/DATA/Pictures/2026/a.jpg", "/DATA/Photos2"]);
  expect(moved(links, "/DATA/Photos", null).map((l) => l.path)).toEqual(["/DATA/Photos2"]);
});

test("wrong passwords: a pause after five, counted anew after it", () => {
  let tries = undefined as ReturnType<typeof wrongOnce> | undefined;
  for (let i = 0; i < TRIES - 1; i++) tries = wrongOnce(tries, 1000);
  expect(pausedFor(tries, 1000)).toBe(0);
  tries = wrongOnce(tries, 1000);
  expect(pausedFor(tries, 1000)).toBe(600);
  expect(pausedFor(tries, 1000 + 600_000)).toBe(0);
  expect(wrongOnce(tries, 1000 + 600_000)).toEqual({ count: 1, until: 0 });
});

test("a drop takes what fits its limit", () => {
  expect(roomInDrop({ limit: 0, received: 1e12 }, 1e12)).toBe(true);
  expect(roomInDrop({ limit: 100, received: 60 }, 40)).toBe(true);
  expect(roomInDrop({ limit: 100, received: 60 }, 41)).toBe(false);
});

const linkTo = (path: string, dir = true): ShareLink => ({ id: "0a0b0c0d", token: "A".repeat(22), kind: "get", path, dir, by: "u1", made: 0, expires: 0, limit: 0, received: 0, files: 0, opened: 0, last: 0, note: "" });

test("inside a folder's link: what is there, without links out and Hata's own files", () => {
  const top = mkdtempSync(join(tmpdir(), "hata-link-"));
  const outside = mkdtempSync(join(tmpdir(), "hata-out-"));
  writeFileSync(join(outside, "secret.txt"), "no");
  mkdirSync(join(top, "trip"));
  writeFileSync(join(top, "trip", "a.jpg"), "jpg");
  writeFileSync(join(top, "b.txt"), "bb");
  writeFileSync(join(top, ".hata-upload-abcdefgh"), "half");
  symlinkSync(outside, join(top, "away"));
  symlinkSync(join(outside, "secret.txt"), join(top, "trip", "s.txt"));
  const link = linkTo(top);
  expect(entriesOf(link, "").entries.map((e) => [e.name, e.type])).toEqual([["trip", "dir"], ["b.txt", "file"]]);
  expect(entriesOf(link, "trip").entries.map((e) => e.name)).toEqual(["a.jpg"]);
  expect(inside(link, "trip/a.jpg")).toBe(join(top, "trip", "a.jpg"));
  const refused = (rel: string) => {
    try {
      inside(link, rel);
      return "";
    } catch (e) {
      return (e as Error).message;
    }
  };
  expect(refused("away/secret.txt")).toBe("links.notFound");
  expect(refused("trip/s.txt")).toBe("links.notFound");
  expect(refused("../x")).toBe("links.notFound");
  expect(refused("nothing")).toBe("links.notFound");
  // a file's link opens only the file itself
  expect(inside(linkTo(join(top, "b.txt"), false), "")).toBe(join(top, "b.txt"));
  expect(() => inside(linkTo(join(top, "b.txt"), false), "x")).toThrow("links.notFound");
});
