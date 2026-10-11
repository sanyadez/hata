import { expect, test } from "bun:test";
import type { Disk, Volume } from "../src/disks";
import { blockers, holds, mountable, NAME_RE, optionsFor, parseFstab, suggestName, withMount, withoutMount } from "../src/mounting";

const volume = (patch: Partial<Volume> = {}): Volume => ({ name: "sdb1", path: "/dev/sdb1", kind: "part", size: 1e9, fstype: "ext4", label: "", uuid: "u-1", mounts: [], swap: false, total: null, used: null, ...patch });
const disk = (volumes: Volume[] = [], patch: Partial<Disk> = {}): Disk => ({ name: "sdb", path: "/dev/sdb", model: "Disk", serial: "S1", size: 4e9, transport: "sata", rotational: true, removable: false, readOnly: false, volumes, ...patch });

test("blockers: an empty disk and one with files nobody uses may be erased", () => {
  expect(blockers(disk())).toEqual([]);
  expect(blockers(disk([volume(), volume({ name: "sdb2", path: "/dev/sdb2", fstype: "ntfs" })]))).toEqual([]);
});

test("blockers: the system's disk, a disk in use, swap, a member of something larger, a read-only one", () => {
  expect(blockers(disk([volume({ mounts: ["/boot/efi"] }), volume({ mounts: ["/"] }), volume({ fstype: "swap", swap: true })]))).toEqual(["system", "swap"]);
  expect(blockers(disk([volume({ mounts: ["/var"] })]))).toEqual(["system"]);
  expect(blockers(disk([volume({ mounts: ["/DATA"] })]))).toEqual(["mounted"]);
  expect(blockers(disk([volume({ mounts: ["/home/media"] })]))).toEqual(["mounted"]);
  expect(blockers(disk([volume({ fstype: "LVM2_member" })]))).toEqual(["member"]);
  expect(blockers(disk([volume({ fstype: "linux_raid_member" })]))).toEqual(["member"]);
  expect(blockers(disk([volume({ fstype: "crypto_LUKS" }), volume({ kind: "crypt", name: "data", path: "/dev/mapper/data" })]))).toEqual(["member"]);
  expect(blockers(disk([volume({ kind: "lvm", mounts: ["/"] })]))).toEqual(["system", "member"]);
  expect(blockers(disk([], { readOnly: true }))).toEqual(["readonly"]);
});

test("mountable: a known file system that is not in use and not a piece of something", () => {
  expect(mountable(volume())).toBe(true);
  expect(mountable(volume({ fstype: "exfat" }))).toBe(true);
  expect(mountable(volume({ kind: "disk", fstype: "ntfs" }))).toBe(true);
  expect(mountable(volume({ mounts: ["/mnt/a"] }))).toBe(false);
  expect(mountable(volume({ fstype: "" }))).toBe(false);
  expect(mountable(volume({ fstype: "swap" }))).toBe(false);
  expect(mountable(volume({ fstype: "LVM2_member" }))).toBe(false);
  expect(mountable(volume({ kind: "lvm" }))).toBe(false);
});

test("names: what may be a folder under /mnt, and a name made from a label", () => {
  for (const ok of ["media", "disk-2", "My_Films.2024", "a"]) expect(NAME_RE.test(ok)).toBe(true);
  for (const bad of ["", "-x", ".hidden", "a/b", "..", "a b", "кіно", "x".repeat(33)]) expect(NAME_RE.test(bad)).toBe(false);
  expect(suggestName("Samsung T7")).toBe("Samsung-T7");
  expect(suggestName("  WDC WD40EFRX-68N32N0 ")).toBe("WDC-WD40EFRX-68N32N0");
  expect(suggestName("Кіно")).toBe("disk");
  expect(suggestName("../../etc")).toBe("etc");
  expect(suggestName("a".repeat(40))).toHaveLength(24);
  for (const text of ["Samsung T7", "../../etc", "--x--", "my disk (2)", "a".repeat(40) + "."]) expect(NAME_RE.test(suggestName(text))).toBe(true);
});

const FSTAB = `# /etc/fstab: static file system information.
UUID=aaaa / ext4 errors=remount-ro 0 1
# swap
UUID=bbbb none swap sw 0 0
//nas/media /mnt/with\\040space cifs credentials=/root/.smb 0 0
`;

test("fstab: lines are read, Hata's own are told apart", () => {
  const text = withMount(FSTAB, { spec: "UUID=cccc", path: "/mnt/media", fstype: "ext4", options: optionsFor("ext4", true) });
  expect(parseFstab(text)).toEqual([
    { spec: "UUID=aaaa", path: "/", fstype: "ext4", options: "errors=remount-ro", ours: false },
    { spec: "UUID=bbbb", path: "none", fstype: "swap", options: "sw", ours: false },
    { spec: "//nas/media", path: "/mnt/with space", fstype: "cifs", options: "credentials=/root/.smb", ours: false },
    { spec: "UUID=cccc", path: "/mnt/media", fstype: "ext4", options: "defaults,noatime,nofail,x-systemd.device-timeout=10s", ours: true },
  ]);
  expect(text.startsWith(FSTAB)).toBe(true);
  expect(text.endsWith("UUID=cccc /mnt/media ext4 defaults,noatime,nofail,x-systemd.device-timeout=10s 0 2\n")).toBe(true);
});

test("fstab: adding again replaces, removing gives the file back as it was, foreign lines are never touched", () => {
  const once = withMount(FSTAB, { spec: "UUID=cccc", path: "/mnt/media", fstype: "ext4", options: "defaults" });
  const twice = withMount(once, { spec: "UUID=dddd", path: "/mnt/media", fstype: "ntfs3", options: optionsFor("ntfs", true) });
  expect(parseFstab(twice).filter((e) => e.path === "/mnt/media")).toEqual([{ spec: "UUID=dddd", path: "/mnt/media", fstype: "ntfs3", options: "rw,umask=000,nofail,x-systemd.device-timeout=10s", ours: true }]);
  expect(twice.endsWith(" 0 0\n")).toBe(true);
  expect(withoutMount(twice, "/mnt/media")).toBe(FSTAB);
  // a line somebody else wrote for a folder is theirs, also when asked to remove it
  expect(withoutMount(FSTAB, "/mnt/with space")).toBe(FSTAB);
  expect(withoutMount(FSTAB, "/")).toBe(FSTAB);
  // a file without a line break at its end
  expect(withMount("UUID=aaaa / ext4 defaults 0 1", { spec: "UUID=c", path: "/mnt/a b", fstype: "ext4", options: "defaults" }).split("\n")).toEqual(["UUID=aaaa / ext4 defaults 0 1", expect.stringContaining("# Hata:"), "UUID=c /mnt/a\\040b ext4 defaults 0 2", ""]);
  // Hata's comment left alone above somebody's line marks nothing
  const orphan = "# Hata: old\n\nUUID=aaaa / ext4 defaults 0 1\n";
  expect(parseFstab(orphan)[0]!.ours).toBe(false);
  expect(withoutMount(orphan, "/")).toBe(orphan);
});

test("optionsFor: only a kept line waits for nobody; file systems without owners are open to all", () => {
  expect(optionsFor("ext4", false)).toBe("defaults,noatime");
  expect(optionsFor("vfat", false)).toBe("rw,umask=000,utf8");
  expect(optionsFor("exfat", true)).toBe("rw,umask=000,nofail,x-systemd.device-timeout=10s");
});

test("holds: what of Hata lives on a folder", () => {
  const uses = { dataRoot: "/mnt/big/DATA", backupDir: "/mnt/usb/Backups", state: ["/var/lib/hata", "/etc/hata"], shares: ["/mnt/films/HD"] };
  expect(holds("/mnt/big", uses)).toBe("data");
  expect(holds("/mnt/usb", uses)).toBe("backups");
  expect(holds("/mnt/films", uses)).toBe("share");
  expect(holds("/var", uses)).toBe("state");
  expect(holds("/mnt/bi", uses)).toBeNull();
  expect(holds("/mnt/other", { ...uses, backupDir: "" })).toBeNull();
});

test("pools: merged folders are read back from Hata's lines; what can be merged", async () => {
  const { mergeable, poolOptions, pools, POOL_FS } = await import("../src/mounting");
  let text = FSTAB;
  for (const name of ["a", "b", "c"]) text = withMount(text, { spec: `UUID=${name}`, path: `/mnt/${name}`, fstype: "ext4", options: optionsFor("ext4", true) });
  text = withMount(text, { spec: "UUID=w", path: "/mnt/win", fstype: "ntfs3", options: optionsFor("ntfs", true) });
  const mounted = ["/", "/mnt/a", "/mnt/b", "/mnt/win"];
  // not the one that is not there now, not the one without owners, not what Hata did not connect
  expect(mergeable(parseFstab(text), mounted)).toEqual(["/mnt/a", "/mnt/b"]);
  const merged = withMount(text, { spec: "/mnt/a:/mnt/b", path: "/mnt/storage", fstype: POOL_FS, options: poolOptions("storage", ["/mnt/a", "/mnt/b"]) });
  expect(pools(parseFstab(merged))).toEqual({ "/mnt/storage": ["/mnt/a", "/mnt/b"] });
  expect(merged.trimEnd().split("\n").at(-1)).toBe("/mnt/a:/mnt/b /mnt/storage fuse.mergerfs cache.files=off,category.create=mfs,moveonenospc=true,minfreespace=1G,allow_other,fsname=storage,nofail,x-systemd.requires-mounts-for=/mnt/a,x-systemd.requires-mounts-for=/mnt/b 0 0");
  // a disk in a merged folder is not offered again, and the merged folder itself never
  expect(mergeable(parseFstab(merged), [...mounted, "/mnt/c", "/mnt/storage"])).toEqual(["/mnt/c"]);
  expect(pools(parseFstab(withoutMount(merged, "/mnt/storage")))).toEqual({});
  // somebody's own mergerfs line is not Hata's
  expect(pools(parseFstab("/a:/b /mnt/x fuse.mergerfs defaults 0 0\n"))).toEqual({});
});
