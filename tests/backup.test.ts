import { expect, test } from "bun:test";
import { appDir } from "../src/apps";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expired, movedAppDir, nextRun, restorable, tarMove, withoutNested, type Snapshot } from "../src/backup";
import { listServerSnapshots, stateExcludes, strayMembers } from "../src/restore";

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

test("the server's snapshot leaves out what must not travel, and the backups themselves", () => {
  expect(stateExcludes("/var/lib/hata", "/DATA/Backups")).toEqual(["./sessions.json", "./stores", "./update.json", "./restore.json", "./.hata-state"]);
  expect(stateExcludes("/var/lib/hata", "/var/lib/hata/backups")).toContain("./backups");
  expect(stateExcludes("/var/lib/hata", "/var/lib/hata")).toHaveLength(5);
});

test("a state archive may only hold what unpacks inside the state directory", () => {
  expect(strayMembers("./\n./settings.json\n./apps/\n./apps/memos/compose.yml\n")).toEqual([]);
  expect(strayMembers("./settings.json\n/etc/passwd\n")).toEqual(["/etc/passwd"]);
  expect(strayMembers("./apps/../../etc/cron.d/x\n")).toEqual(["./apps/../../etc/cron.d/x"]);
  expect(strayMembers("etc/passwd\n")).toEqual(["etc/passwd"]);
});

test("snapshots of the server are found by their description and archive, newest first", () => {
  const dir = mkdtempSync(join(tmpdir(), "hata-server-"));
  mkdirSync(join(dir, "_server"));
  const put = (id: string, at: number, archive = true) => {
    writeFileSync(join(dir, "_server", id + ".json"), JSON.stringify({ id, at, reason: "schedule", size: 1, version: "0.1.1", apps: ["memos"] }));
    if (archive) writeFileSync(join(dir, "_server", id + ".tar.gz"), "x");
  };
  put("20261001-030000", 1);
  put("20261002-030000", 2);
  put("20261003-030000", 3, false);
  writeFileSync(join(dir, "_server", "notes.json"), "{}");
  expect(listServerSnapshots(dir).map((s) => s.id)).toEqual(["20261002-030000", "20261001-030000"]);
  expect(listServerSnapshots(join(dir, "nope"))).toEqual([]);
});

test("a snapshot taken where the apps used to be kept is restored to where they are kept now", () => {
  const paths = ["/var/lib/hata/apps/memos", "/DATA/AppData/memos"];
  expect(movedAppDir(paths, "memos", "/mnt/disk/hata/apps/memos")).toBe("/var/lib/hata/apps/memos");
  expect(movedAppDir(paths, "memos", "/var/lib/hata/apps/memos")).toBeNull();
  expect(movedAppDir(["/DATA/AppData/memos"], "memos", "/x/apps/memos")).toBeNull();
  // another app's directory is not this app's, and never becomes restorable by this route
  expect(movedAppDir(["/var/lib/hata/apps/other"], "memos", "/x/apps/memos")).toBeNull();
  expect(tarMove("/var/lib/hata/apps/memos", "/mnt/my disk/hata.d/apps/memos")).toBe("--transform=s|^var/lib/hata/apps/memos|mnt/my disk/hata.d/apps/memos|rh");
  expect(tarMove("/srv/a.b/apps/memos", "/srv/a&b|c/apps/memos")).toBe("--transform=s|^srv/a\\.b/apps/memos|srv/a\\&b\\|c/apps/memos|rh");
});
