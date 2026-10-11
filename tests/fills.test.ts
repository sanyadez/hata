import { expect, test } from "bun:test";
import { addSample, breakdown, fullIn, parseDu, weekly, type Sample } from "../src/fills";

const GB = 1024 ** 3;
const DAY = 24 * 3600_000;

test("parseDu: kilobytes per folder, a line that is not one is skipped", () => {
  expect(parseDu("4\t/DATA/Media\n12\t/DATA/App Data/with\ttab\nnot a line\n\n100\t/DATA\n")).toEqual([
    { path: "/DATA/Media", size: 4096 },
    { path: "/DATA/App Data/with\ttab", size: 12288 },
    { path: "/DATA", size: 102400 },
  ]);
});

test("breakdown: folders, one part per app, the trash, what is left — largest first", () => {
  const rows = [
    { path: "/DATA/AppData/immich/library", size: 600 * GB },
    { path: "/DATA/AppData/immich", size: 620 * GB },
    { path: "/DATA/AppData/memos", size: 2 * GB },
    { path: "/DATA/AppData", size: 622 * GB },
    { path: "/DATA/Media/Films", size: 2000 * GB },
    { path: "/DATA/Media", size: 2100 * GB },
    { path: "/DATA/.hata-trash/abc", size: 5 * GB },
    { path: "/DATA/.hata-trash", size: 5 * GB },
    { path: "/DATA/Empty", size: 0 },
    { path: "/DATA", size: 2730 * GB },
  ];
  const { total, parts } = breakdown(rows, "/DATA");
  expect(total).toBe(2730 * GB);
  expect(parts).toEqual([
    { kind: "folder", path: "/DATA/Media", name: "Media", size: 2100 * GB },
    { kind: "app", path: "/DATA/AppData/immich", name: "immich", size: 620 * GB },
    { kind: "trash", path: "/DATA/.hata-trash", name: ".hata-trash", size: 5 * GB },
    { kind: "app", path: "/DATA/AppData/memos", name: "memos", size: 2 * GB },
    { kind: "rest", path: "/DATA", name: "", size: 3 * GB },
  ]);
});

test("breakdown: a folder that is another disk is named and not counted; a data folder at / works", () => {
  const { parts } = breakdown(
    [
      { path: "/DATA/Media", size: 4096 },
      { path: "/DATA/Docs", size: GB },
      { path: "/DATA", size: GB + 8192 },
    ],
    "/DATA",
    new Set(["/DATA/Media"]),
  );
  expect(parts).toEqual([
    { kind: "folder", path: "/DATA/Docs", name: "Docs", size: GB },
    { kind: "mount", path: "/DATA/Media", name: "Media", size: 0 },
  ]);
  const root = breakdown(
    [
      { path: "/AppData/memos", size: GB },
      { path: "/AppData", size: GB },
      { path: "/home", size: 2 * GB },
      { path: "/", size: 3 * GB },
    ],
    "/",
  );
  expect(root.parts.map((p) => [p.kind, p.path])).toEqual([
    ["folder", "/home"],
    ["app", "/AppData/memos"],
  ]);
});

const sample = (day: number, used: number, parts: Record<string, number> = {}, total = 1000 * GB): Sample => ({ at: day * DAY + 3600_000, used, total, parts });

test("addSample: one a day, the old ones dropped", () => {
  let samples = [sample(1, GB), sample(2, 2 * GB)];
  samples = addSample(samples, { ...sample(2, 3 * GB), at: 2 * DAY + 7200_000 });
  expect(samples.map((s) => s.used)).toEqual([GB, 3 * GB]);
  samples = addSample(samples, sample(92, 4 * GB));
  expect(samples.map((s) => s.used)).toEqual([3 * GB, 4 * GB]);
});

test("weekly: the change against the sample about a week old, as a week's worth", () => {
  const now = 20 * DAY + 3600_000;
  const samples = [sample(1, 0, { "/DATA/Media": 10 * GB }), sample(13, 0, { "/DATA/Media": 100 * GB }), sample(14, 0, { "/DATA/Media": 110 * GB }), sample(20, 0, { "/DATA/Media": 146 * GB, "/DATA/New": 6 * GB })];
  // the sample of day 13 is the one nearest to a week ago
  expect(weekly(samples, "/DATA/Media", now)).toBe(46 * GB);
  expect(weekly(samples, "/DATA/New", now)).toBe(6 * GB);
  expect(weekly([sample(18, 0), sample(20, 0)], "/DATA/Media", now)).toBeNull();
  expect(weekly([], "/DATA/Media", now)).toBeNull();
});

test("fullIn: a straight line through the last month", () => {
  const now = 10 * DAY + 3600_000;
  // 10 GB a day, 100 GB left
  const growing = Array.from({ length: 10 }, (_, i) => sample(i + 1, (800 + i * 10) * GB));
  expect(fullIn(growing, now)).toBe(11);
  expect(fullIn(growing.slice(-2), now)).toBeNull();
  expect(fullIn(growing.map((s) => ({ ...s, used: 500 * GB })), now)).toBeNull();
  expect(fullIn(growing.map((s, i) => ({ ...s, used: (800 - i) * GB })), now)).toBeNull();
  // a year is not enough at this pace
  expect(fullIn(growing.map((s, i) => ({ ...s, used: (100 + i * 0.1) * GB })), now)).toBeNull();
  // the disk was replaced with a larger one two days ago: too little to go by
  expect(fullIn([...growing.slice(0, 8), sample(9, 880 * GB, {}, 4000 * GB), sample(10, 890 * GB, {}, 4000 * GB)], now)).toBeNull();
});
