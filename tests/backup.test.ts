import { expect, test } from "bun:test";
import { appDir } from "../src/apps";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseListing, unescape, indexOf } from "../src/snapshot";
import { roomNeeded, extraAllowed, expired, movedAppDir, nextRun, restorable, tarMove, withoutNested, type Snapshot } from "../src/backup";
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
  // Docker with another data-root keeps the volumes there
  expect(restorable("/srv/docker/volumes/memos_data/_data", "memos", "/DATA", "/srv/docker/volumes")).toBe(true);
  expect(restorable("/var/lib/docker/volumes/memos_data/_data", "memos", "/DATA", "/srv/docker/volumes")).toBe(false);
  expect(restorable("/srv/docker/volumes/memos_data/_data/x", "memos", "/DATA", "/srv/docker/volumes")).toBe(false);
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

test("folders outside AppData: which may go into a snapshot", () => {
  const ok = (path: string) => extraAllowed(path, "/DATA", ["/var/lib/hata", "/etc/hata"]);
  for (const path of ["/DATA/Media", "/mnt/big/films", "/srv/photos", "/home/me/docs", "/storage", "/var/lib/app", "/opt/app/data"]) expect(ok(path)).toBe(true);
  for (const path of ["/", "/DATA", "/mnt", "/home", "/var", "/etc/app", "/usr/share/x", "/var/lib/docker/volumes/x", "/var/run/docker.sock", "/var/lib/hata", "/var/lib/hata/apps/x", "/var/lib", "/DATA/../etc", "/DATA//Media", "/DATA/Media/", "relative", "/proc/1"]) expect(ok(path)).toBe(false);
});

test("parseListing: what tar says a snapshot holds", () => {
  const out = [
    "drwxr-xr-x 0/0               0 2026-10-09 03:14 DATA/AppData/memos/",
    "-rw-r--r-- 1000/1000     52341 2026-10-08 21:05 DATA/AppData/memos/memos prod.db",
    "lrwxrwxrwx 0/0               0 2026-10-01 10:00 DATA/AppData/memos/latest -> memos prod.db",
    "hrw-r--r-- 0/0               0 2026-10-01 10:00 DATA/AppData/memos/twin link to DATA/AppData/memos/memos prod.db",
    "-rw-r--r-- 0/0              12 2026-10-01 10:00 DATA/AppData/memos/\\320\\244\\320\\276\\321\\202\\320\\276/a\\nb.txt",
    "crw-rw-rw- 0/0             1,3 2026-10-01 10:00 DATA/AppData/memos/null",
    "-rw-r--r-- 0/0               1 2026-10-01 10:00 ../../etc/passwd",
    "tar: Removing leading `/' from member names",
    "",
  ].join("\n");
  const entries = parseListing(out);
  expect(entries.map((e) => e.path)).toEqual(["/DATA/AppData/memos", "/DATA/AppData/memos/memos prod.db", "/DATA/AppData/memos/latest", "/DATA/AppData/memos/twin", "/DATA/AppData/memos/Фото/a\nb.txt", "/DATA/AppData/memos/null"]);
  expect(entries[0]).toEqual({ path: "/DATA/AppData/memos", dir: true, size: 0, at: Date.UTC(2026, 9, 9, 3, 14), link: "" });
  expect(entries[1]).toMatchObject({ dir: false, size: 52341 });
  expect(entries[2]!.link).toBe("memos prod.db");
  expect(entries[3]!.link).toBe("DATA/AppData/memos/memos prod.db");
  expect(entries[5]!.size).toBe(0);
  const index = indexOf(entries);
  expect(index.children.get("/DATA/AppData/memos")!.map((e) => e.path.split("/").pop())).toEqual(["memos prod.db", "latest", "twin", "null"]);
  expect(index.byPath.get("/DATA/AppData/memos")!.dir).toBe(true);
  expect(unescape("plain name")).toBe("plain name");
  expect(unescape("a\\\\b\\tc")).toBe("a\\b\tc");
});

test("roomNeeded: media counts whole, the app's own data a third", () => {
  expect(roomNeeded(0, 0)).toBe(0);
  expect(roomNeeded(1000, 0)).toBe(1000);
  expect(roomNeeded(1000, 300)).toBe(1100);
  expect(roomNeeded(0, 10)).toBe(4);
});
