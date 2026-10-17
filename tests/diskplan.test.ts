import { expect, test } from "bun:test";
import { dataOf, folderOf, readPlan, type Plan } from "../src/diskplan";

const fmt = (disk: string, name: string, device = "") => ({ disk, serial: "S" + disk, size: 1e12, device, step: "format", name });
const ready = (disk: string, path: string) => ({ disk, serial: "S" + disk, size: 1e12, device: `/dev/${disk}1`, step: "ready", path });

test("readPlan: both — data disks merged, one for parity", () => {
  const plan = readPlan({ goal: "both", disks: [fmt("sdb", "disk1"), ready("sdc", "/mnt/films"), fmt("sdd", "parity1")], parity: 2, name: "storage", time: "03:30" }) as Plan;
  expect(typeof plan).toBe("object");
  expect(dataOf(plan).map(folderOf)).toEqual(["/mnt/disk1", "/mnt/films"]);
  expect(folderOf(plan.disks[2]!)).toBe("/mnt/parity1");
  expect(plan.time).toBe("03:30");
  expect(plan.scrub).toBe(true);
});

test("readPlan: how many disks each goal takes", () => {
  expect(readPlan({ goal: "merge", disks: [fmt("sdb", "a")], name: "pool" })).toBe("plan.fewDisks");
  expect(typeof readPlan({ goal: "merge", disks: [fmt("sdb", "a"), fmt("sdc", "b")], name: "pool" })).toBe("object");
  expect(typeof readPlan({ goal: "protect", disks: [fmt("sdb", "a"), fmt("sdc", "b")], parity: 1 })).toBe("object");
  expect(readPlan({ goal: "both", disks: [fmt("sdb", "a"), fmt("sdc", "b")], parity: 1, name: "pool" })).toBe("plan.fewDisks");
  expect(readPlan({ goal: "protect", disks: [fmt("sdb", "a"), fmt("sdc", "b")] })).toBe("plan.noParity");
  expect(readPlan({ goal: "protect", disks: [fmt("sdb", "a"), fmt("sdc", "b")], parity: 2 })).toBe("plan.noParity");
});

test("readPlan: refuses the same folder, the same disk twice, bad names", () => {
  expect(readPlan({ goal: "merge", disks: [fmt("sdb", "a"), fmt("sdc", "a")], name: "pool" })).toBe("plan.sameFolder");
  expect(readPlan({ goal: "merge", disks: [fmt("sdb", "a"), fmt("sdc", "b")], name: "a" })).toBe("plan.sameFolder");
  expect(readPlan({ goal: "merge", disks: [fmt("sdb", "a"), fmt("sdb", "b", "/dev/sdb2")], name: "pool" })).toBe("plan.sameDisk");
  expect(readPlan({ goal: "merge", disks: [fmt("sdb", "a", "/dev/sdb1"), fmt("sdb", "b", "/dev/sdb1")], name: "pool" })).toBe("plan.sameDisk");
  expect(typeof readPlan({ goal: "merge", disks: [fmt("sdb", "a", "/dev/sdb1"), fmt("sdb", "b", "/dev/sdb2")], name: "pool" })).toBe("object");
  expect(readPlan({ goal: "merge", disks: [fmt("sdb", "../x"), fmt("sdc", "b")], name: "pool" })).toBe("disk.badName");
  expect(readPlan({ goal: "merge", disks: [fmt("sdb", "a"), fmt("sdc", "b")], name: "" })).toBe("disk.badName");
  expect(readPlan({ goal: "merge", disks: [fmt("sdb; rm", "a"), fmt("sdc", "b")], name: "pool" })).toBe("plan.bad");
  expect(readPlan({ goal: "merge", disks: [{ ...ready("sdb", "relative"), step: "ready" }, fmt("sdc", "b")], name: "pool" })).toBe("plan.bad");
  expect(readPlan({ goal: "raid0", disks: [] })).toBe("plan.bad");
});
