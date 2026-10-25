import { expect, test } from "bun:test";
import { appDataRule, diskName, fileFilter, fixed, goneFiles, isOurs, parseDiff, parseStatus, progressOf, refusal, snapraidConf, unprotected } from "../src/snapraid";

test("diskName: what SnapRAID calls a disk, never a name that is taken", () => {
  expect(diskName("/mnt/d1", [])).toBe("d1");
  expect(diskName("/mnt/My Films!", [])).toBe("myfilms");
  expect(diskName("/mnt/d1", ["d1", "d12"])).toBe("d13");
  expect(diskName("/mnt/d1", ["d1"])).toBe("d12");
  expect(diskName("/mnt/Диск", [])).toBe("disk");
  expect(diskName("/mnt/Диск", ["disk"])).toBe("disk2");
});

test("appDataRule: where AppData lies inside a data disk", () => {
  expect(appDataRule("/mnt/d1", ["/mnt/d1", "/mnt/d2"], {})).toBe("/AppData/");
  expect(appDataRule("/mnt/d1/DATA", ["/mnt/d1"], {})).toBe("/DATA/AppData/");
  expect(appDataRule("/DATA", ["/mnt/d1"], {})).toBeNull();
  expect(appDataRule("/mnt/d10/DATA", ["/mnt/d1"], {})).toBeNull();
  // on a merged folder every disk has the same folders inside
  expect(appDataRule("/mnt/storage/DATA", ["/mnt/d1", "/mnt/d2"], { "/mnt/storage": ["/mnt/d1", "/mnt/d2"] })).toBe("/DATA/AppData/");
  expect(appDataRule("/mnt/storage", ["/mnt/d1"], { "/mnt/storage": ["/mnt/d1", "/mnt/d2"] })).toBe("/AppData/");
  expect(appDataRule("/mnt/storage/DATA", ["/mnt/d3"], { "/mnt/storage": ["/mnt/d1", "/mnt/d2"] })).toBeNull();
});

test("snapraidConf: the whole file, with a list of the content on the system disk and on every data disk", () => {
  const conf = snapraidConf({ parity: "/mnt/big", data: [{ name: "d1", path: "/mnt/d1" }, { name: "films", path: "/mnt/My Films" }] }, ["/DATA/AppData/"]);
  expect(isOurs(conf)).toBe(true);
  expect(isOurs("# my own\nparity /x\n")).toBe(false);
  expect(conf).toContain("\nparity /mnt/big/snapraid.parity\ncontent /var/lib/snapraid/snapraid.content\ncontent /mnt/d1/snapraid.content\ncontent /mnt/My Films/snapraid.content\ndata d1 /mnt/d1/\ndata films /mnt/My Films/\n");
  expect(conf).toContain("exclude /.hata-trash/\n");
  expect(conf).toContain("exclude /DATA/AppData/\n");
  expect(snapraidConf({ parity: "/mnt/big", data: [{ name: "d1", path: "/mnt/d1" }] }, [])).not.toContain("AppData");
});

const DIFF = `Loading state from /var/lib/snapraid/snapraid.content...
Comparing...
add Media/new.txt
update Docs/док\\ 1.bin
remove Media/film2.bin

       4 equal
       1 added
       1 removed
       1 updated
       0 moved
       0 copied
       0 restored
There are differences!
`;

test("parseDiff: what changed since the last sync", () => {
  expect(parseDiff(DIFF)).toEqual({ equal: 4, added: 1, removed: 1, updated: 1, moved: 0, copied: 0, restored: 0 });
  expect(unprotected(parseDiff(DIFF))).toBe(2);
  expect(parseDiff("Loading state...\nError opening file\n")).toBeNull();
  expect(unprotected(null)).toBe(0);
});

test("parseStatus: damage found, a sync cut short", () => {
  expect(parseStatus("No sync is in progress.\nNo rehash is in progress or needed.\nNo error detected.\n")).toEqual({ errors: 0, unfinished: false });
  expect(parseStatus("No sync is in progress.\nDANGER! In the array there are 3 errors!\n\nThey are from block 0 to 7\n")).toEqual({ errors: 3, unfinished: false });
  expect(parseStatus("DANGER! In the array there is 1 errors!\n").errors).toBe(1);
  expect(parseStatus("WARNING! The array is NOT fully synced.\nYou have a sync in progress at 43%.\n").unfinished).toBe(true);
});

test("refusal: why a sync would not run, when it is for a person to decide", () => {
  expect(refusal("Scanned d1 in 0 seconds\nWARNING! All the files previously present in disk 'd1' at dir '/mnt/d1/'\nare now missing or have been rewritten!\n")).toEqual({ code: "diskEmpty", disk: "d1" });
  expect(refusal("WARNING! The Parity parity has only 0 blocks instead of 37.\nDANGER! One or more the parity files are smaller than expected!\n")).toEqual({ code: "parityLost", disk: "" });
  expect(refusal("Error writing the content file\n")).toBeNull();
});

test("progressOf and fixed: how far a run got, what came back", () => {
  expect(progressOf("12%, 340 MB, 91 MB/s, 3 stripe/s, CPU 4%, 0:03 ETA")).toBe(12);
  expect(progressOf("100% completed, 11 MB accessed in 0:00")).toBe(100);
  expect(progressOf("     d1  4% | **")).toBeNull();
  expect(progressOf("100% of the array is not scrubbed.")).toBeNull();
  expect(fixed("Fixing...\nrecovered Media/film2.bin\nrecovered Docs/док\\ 1.bin\n      12 errors\n      12 recovered errors\n       0 unrecoverable errors\nEverything OK\n")).toEqual({ recovered: ["Media/film2.bin", "Docs/док 1.bin"], unrecoverable: 0 });
  expect(fixed("unrecoverable Media/x.bin\n       4 errors\n       0 recovered errors\n       4 unrecoverable errors\n")).toEqual({ recovered: [], unrecoverable: 4 });
});

test("a second parity, and one file brought back", () => {
  const conf = snapraidConf({ parity: "/mnt/big", parity2: "/mnt/big2", data: [{ name: "d1", path: "/mnt/d1" }, { name: "d2", path: "/mnt/d2" }] }, []);
  expect(conf).toContain("parity /mnt/big/snapraid.parity\n2-parity /mnt/big2/snapraid.2-parity\n");
  expect(snapraidConf({ parity: "/mnt/big", parity2: "", data: [{ name: "d1", path: "/mnt/d1" }] }, [])).not.toContain("2-parity");
  const log = "statfs:ext2/3/4: /mnt/e4/ \nscan:update:e4:Films/film3.mkv: 20971520 1.5 -> 20971522 1.6\nscan:remove:e4:Films/film1.mkv\nscan:remove:d6:Music/пісня 2.mp3\nscan:remove:d6:a\\db\\nc\nsummary:removed:3\n";
  expect(goneFiles(log)).toEqual([
    { disk: "e4", path: "Films/film1.mkv" },
    { disk: "d6", path: "Music/пісня 2.mp3" },
    { disk: "d6", path: "a:b\nc" },
  ]);
  // from the top of the disk, the characters of a pattern taken as themselves
  expect(fileFilter("Music/x [1].mp3")).toBe("/Music/x \\[1\\].mp3");
  expect(fileFilter("a*b?.txt")).toBe("/a\\*b\\?.txt");
});
