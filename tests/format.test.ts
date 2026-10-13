import { expect, test } from "bun:test";
import { checkCommand, checkVerdict, cleanLabel, familyOf, FAT_MAX, isFs, labelCommand, mkfsCommand, partType, tableFor, tableScript } from "../src/format";

test("isFs, familyOf: the file systems Hata makes, and the ones it checks", () => {
  for (const fs of ["ext4", "exfat", "vfat", "ntfs"]) expect(isFs(fs)).toBe(true);
  for (const other of ["", "btrfs", "ext3", "constructor", 4, null]) expect(isFs(other)).toBe(false);
  expect(familyOf("ext2")).toBe("ext4");
  expect(familyOf("ext4")).toBe("ext4");
  expect(familyOf("vfat")).toBe("vfat");
  expect(familyOf("xfs")).toBeNull();
  expect(familyOf("")).toBeNull();
});

test("cleanLabel: what each file system can carry of a typed name", () => {
  expect(cleanLabel("vfat", "My stick, 2024")).toBe("MY STICK 20");
  expect(cleanLabel("vfat", "Кіно")).toBe("");
  expect(cleanLabel("vfat", "café")).toBe("CAFE");
  expect(cleanLabel("exfat", "Моя флешка 2024")).toBe("Моя флешка");
  expect(cleanLabel("exfat", "a/b:c")).toBe("abc");
  expect(cleanLabel("ntfs", "x".repeat(40))).toBe("x".repeat(32));
  expect(cleanLabel("ext4", "media/films")).toBe("media-films");
  // sixteen bytes, and never half a character
  expect(cleanLabel("ext4", "Резервні копії")).toBe("Резервні");
  expect(cleanLabel("ext4", "  two\twords\n ")).toBe("two words");
  expect(cleanLabel("exfat", "")).toBe("");
});

test("tableFor, partType: the old table for what other devices read, and a type Windows takes for its own", () => {
  expect(tableFor("exfat", 32e9, true)).toBe("dos");
  expect(tableFor("vfat", 32e9, true)).toBe("dos");
  expect(tableFor("ext4", 32e9, true)).toBe("gpt");
  expect(tableFor("exfat", 500e9, false)).toBe("gpt");
  expect(tableFor("ntfs", FAT_MAX + 1, true)).toBe("gpt");
  expect(partType("dos", "vfat")).toBe("c");
  expect(partType("dos", "exfat")).toBe("7");
  expect(partType("dos", "ext4")).toBe("83");
  expect(partType("gpt", "ntfs")).toBe("EBD0A0A2-B9E5-4433-87C0-68B6B72699C7");
  expect(tableScript("gpt", "ext4")).toBe("label: gpt\n,,0FC63DAF-8483-4772-8E79-3D69D8477DE4\n");
  expect(tableScript("dos", "vfat")).toBe("label: dos\n,,c\n");
});

test("mkfsCommand: each file system's own program and way to say the label", () => {
  expect(mkfsCommand("ext4", "media", "/dev/sdb1", { size: 4e9 })).toEqual(["mkfs.ext4", "-F", "-q", "-m", "0", "-L", "media", "/dev/sdb1"]);
  expect(mkfsCommand("ext4", "", "/dev/sdb1", { size: 4e9 })).toEqual(["mkfs.ext4", "-F", "-q", "-m", "0", "/dev/sdb1"]);
  expect(mkfsCommand("vfat", "STICK", "/dev/sdb1", { size: 4e9 })).toEqual(["mkfs.fat", "-F", "32", "-n", "STICK", "/dev/sdb1"]);
  expect(mkfsCommand("vfat", "", "/dev/sdb1", { size: 64e6 })).toEqual(["mkfs.fat", "/dev/sdb1"]);
  expect(mkfsCommand("exfat", "Кіно", "/dev/sdb1", { size: 4e9 })).toEqual(["mkfs.exfat", "-L", "Кіно", "/dev/sdb1"]);
  expect(mkfsCommand("exfat", "x", "/dev/sdb1", { size: 4e9, legacy: true })).toEqual(["mkfs.exfat", "-n", "x", "/dev/sdb1"]);
  expect(mkfsCommand("ntfs", "Win", "/dev/nvme0n1p2", { size: 4e9 })).toEqual(["mkfs.ntfs", "-Q", "-q", "-L", "Win", "/dev/nvme0n1p2"]);
});

test("checkCommand, labelCommand", () => {
  expect(checkCommand("ext4", false, "/dev/sdb1")).toEqual(["e2fsck", "-f", "-n", "/dev/sdb1"]);
  expect(checkCommand("ext4", true, "/dev/sdb1")).toEqual(["e2fsck", "-f", "-y", "/dev/sdb1"]);
  expect(checkCommand("vfat", true, "/dev/sdb1")).toEqual(["fsck.fat", "-a", "/dev/sdb1"]);
  expect(checkCommand("exfat", false, "/dev/sdb1")).toEqual(["fsck.exfat", "-n", "/dev/sdb1"]);
  expect(checkCommand("ntfs", true, "/dev/sdb1")).toEqual(["ntfsfix", "-d", "/dev/sdb1"]);
  expect(labelCommand("vfat", "/dev/sdb1", "STICK")).toEqual(["fatlabel", "/dev/sdb1", "STICK"]);
  expect(labelCommand("ext4", "/dev/sdb1", "media")).toEqual(["e2label", "/dev/sdb1", "media"]);
});

test("checkVerdict: what the exit code of a check says", () => {
  expect(checkVerdict("ext4", false, 0)).toBe("clean");
  expect(checkVerdict("ext4", false, 4)).toBe("errors");
  expect(checkVerdict("ext4", true, 1)).toBe("fixed");
  expect(checkVerdict("ext4", true, 2)).toBe("fixed");
  expect(checkVerdict("ext4", true, 4)).toBe("errors");
  expect(checkVerdict("ext4", true, 12)).toBe("failed");
  expect(checkVerdict("exfat", false, 4)).toBe("errors");
  expect(checkVerdict("exfat", true, 1)).toBe("fixed");
  expect(checkVerdict("vfat", false, 1)).toBe("errors");
  expect(checkVerdict("vfat", true, 1)).toBe("fixed");
  expect(checkVerdict("vfat", true, 2)).toBe("failed");
  expect(checkVerdict("ntfs", false, 0)).toBe("clean");
  expect(checkVerdict("ntfs", false, 1)).toBe("errors");
  expect(checkVerdict("ntfs", true, 0)).toBe("fixed");
  expect(checkVerdict("ntfs", true, 1)).toBe("failed");
  // the program could not be started at all
  expect(checkVerdict("ext4", false, -1)).toBe("failed");
});
