import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settings } from "../src/config";
import { expired, inTrash, KEEP_DAYS, listTrash, mountPoints, putInTrash, readMeta, sweepTrash, topOf, world, type TrashItem } from "../src/trash";

test("the top of a file system: up to a mount point or to where the device changes", () => {
  const devices: Record<string, number> = { "/": 1, "/mnt": 1, "/mnt/disk": 2, "/mnt/disk/films": 2, "/mnt/disk/films/old": 2, "/pool": 3, "/pool/sub": 4, "/pool/sub/a": 4 };
  const dev = (path: string) => devices[path] ?? null;
  expect(topOf("/mnt/disk/films/old", dev, ["/", "/mnt/disk"])).toBe("/mnt/disk");
  expect(topOf("/mnt", dev, ["/", "/mnt/disk"])).toBe("/");
  expect(topOf("/", dev, ["/"])).toBe("/");
  // a subvolume is no mount point, but a rename does not cross into it
  expect(topOf("/pool/sub/a", dev, ["/", "/pool"])).toBe("/pool/sub");
  // one disk mounted in two places: the nearer mount point, though the device is the same above it
  expect(topOf("/mnt/disk/films/old", () => 2, ["/", "/mnt/disk/films"])).toBe("/mnt/disk/films");
});

test("mount points are read with their escaped spaces", () => {
  expect(mountPoints("/dev/sda1 / ext4 rw 0 0\n/dev/sdb1 /mnt/My\\040Disk ext4 rw 0 0\nproc /proc proc rw 0 0\n\n")).toEqual(["/", "/mnt/My Disk", "/proc"]);
});

test("a path that leads into a trash is told from one that only looks alike", () => {
  expect(["/DATA/.hata-trash", "/DATA/.hata-trash/abc/item/x", "/DATA/my.hata-trash/x", "/DATA/Media"].map(inTrash)).toEqual([true, true, false, false]);
});

test("a description is read; what is not one is nothing", () => {
  const item: TrashItem = { id: "abc", name: "a.txt", from: "/DATA/a.txt", type: "file", size: 5, files: 1, at: 1000, by: "olena" };
  expect(readMeta(JSON.stringify(item), "abc")).toEqual(item);
  expect(readMeta(JSON.stringify({ ...item, type: "socket", by: 7, size: "x" }), "abc")).toMatchObject({ type: "other", by: "", size: 0 });
  for (const bad of ["", "{", "[]", JSON.stringify({ ...item, from: "relative" }), JSON.stringify({ ...item, at: "yesterday" })]) expect(readMeta(bad, "abc")).toBeNull();
  expect(expired(item, 1000 + KEEP_DAYS * 86_400_000)).toBe(false);
  expect(expired(item, 1001 + KEEP_DAYS * 86_400_000)).toBe(true);
});

test("what was deleted long enough ago is swept away, and so is what never became an entry", async () => {
  const root = mkdtempSync(join(tmpdir(), "hata-trash-"));
  settings.dataRoot = root;
  world.remembered.clear();
  const now = Date.now();
  for (const name of ["old.txt", "fresh.txt"]) writeFileSync(join(root, name), name);
  const old = putInTrash(join(root, "old.txt"), { type: "file", size: 7, files: 1 }, "", now - (KEEP_DAYS + 1) * 86_400_000);
  const fresh = putInTrash(join(root, "fresh.txt"), { type: "file", size: 9, files: 1 }, "", now - 3600_000);
  const broken = join(root, ".hata-trash", "0brokenentry00000");
  mkdirSync(broken);
  utimesSync(broken, new Date(now - 2 * 86_400_000), new Date(now - 2 * 86_400_000));
  mkdirSync(join(root, ".hata-trash", "0halfmadenow00000"));
  expect(listTrash().map((item) => item.id)).toEqual([fresh.id, old.id]);
  await sweepTrash(now);
  expect(listTrash().map((item) => item.id)).toEqual([fresh.id]);
  expect(readdirSync(join(root, ".hata-trash")).sort()).toEqual(["0halfmadenow00000", fresh.id].sort());
});
