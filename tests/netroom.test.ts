import { expect, test } from "bun:test";
import { answered, answers, NETWORK_FS, networkMountOf } from "../src/netroom";

test("network file systems are told from the machine's own", () => {
  for (const fs of ["cifs", "smb3", "nfs", "nfs4", "fuse.rclone", "fuse.sshfs"]) expect(NETWORK_FS.test(fs)).toBe(true);
  for (const fs of ["ext4", "btrfs", "fuse.mergerfs", "fuseblk", "tmpfs"]) expect(NETWORK_FS.test(fs)).toBe(false);
});

test("a path of this machine is touched without asking anybody", async () => {
  expect(networkMountOf("/proc/self")).toBe("");
  expect(answered("/proc/self")).toBe(true);
  expect(await answers("/proc/self")).toBe(true);
});
