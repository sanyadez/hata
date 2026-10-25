import { describe, expect, test } from "bun:test";
import { btrfsPool, memberOf, parseBtrfsDf, parseBtrfsScrub, parseBtrfsShow, parseBtrfsStats, parseMdstat, parseZpoolList, parseZpoolStatus, poolTrouble } from "../src/raid";

const MDSTAT = `Personalities : [raid1] [raid6] [raid5] [raid4] [raid0]
md0 : active raid1 sdc1[1] sdb1[0]
      1046528 blocks super 1.2 [2/2] [UU]
      bitmap: 0/1 pages [0KB], 65536KB chunk

md1 : active raid5 sdd1[3] sdc2[1] sdb2[0](F)
      2093056 blocks super 1.2 level 5, 512k chunk, algorithm 2 [3/1] [_U_]
      [=>...................]  recovery =  8.5% (89088/1046528) finish=0.5min speed=29696K/sec

md2 : inactive sdb3[0](S)
      1046528 blocks super 1.2

md3 : active raid1 sde1[0]
      1046528 blocks super 1.2 [2/1] [U_]

md4 : active raid1 sdf1[1] sdg1[0] sdh1[2](S)
      1046528 blocks super 1.2 [2/2] [UU]
      [====>................]  check = 22.1% (231424/1046528) finish=1.2min speed=11571K/sec

md5 : active raid0 sdi1[1] sdj1[0]
      2093056 blocks super 1.2 512k chunks

unused devices: <none>
`;

describe("md", () => {
  const pools = parseMdstat(MDSTAT);
  const by = (name: string) => pools.find((p) => p.name === name)!;
  test("a whole mirror", () => {
    expect(by("md0")).toMatchObject({ kind: "md", id: "md:md0", level: "raid1", state: "ok", size: 1046528 * 1024, work: null });
    expect(by("md0").members.map((m) => [m.path, m.state])).toEqual([["sdb1", "ok"], ["sdc1", "ok"]]);
  });
  test("raid5 with two of three gone is lost; a rebuild in progress is read", () => {
    const md1 = by("md1");
    expect(md1.state).toBe("failed");
    expect(md1.work).toEqual({ what: "rebuild", percent: 8.5, left: 1 });
    expect(md1.members.map((m) => [m.path, m.state])).toEqual([["sdb2", "faulty"], ["sdc2", "ok"], ["sdd1", "rebuilding"]]);
  });
  test("a member's own state in /sys", () => {
    expect(memberOf("in_sync", "0", false)).toBe("ok");
    expect(memberOf("in_sync,write_mostly", "1", false)).toBe("ok");
    expect(memberOf("faulty", "1", false)).toBe("faulty");
    expect(memberOf("spare", "none", true)).toBe("spare");
    expect(memberOf("spare", "1", true)).toBe("rebuilding");
  });
  test("inactive", () => expect(by("md2").state).toBe("inactive"));
  test("a mirror with its second disk gone entirely", () => {
    expect(by("md3").state).toBe("degraded");
    expect(by("md3").members.map((m) => [m.path, m.state])).toEqual([["sde1", "ok"], ["", "missing"]]);
  });
  test("a check and a spare", () => {
    expect(by("md4").work).toEqual({ what: "check", percent: 22.1, left: 2 });
    expect(by("md4").members.find((m) => m.path === "sdh1")?.state).toBe("spare");
  });
  test("raid0 has no slots and is whole", () => expect(by("md5")).toMatchObject({ level: "raid0", state: "ok" }));
  test("a waiting resync", () => {
    const [pool] = parseMdstat("md9 : active raid1 sda1[0] sdb1[1]\n      100 blocks super 1.2 [2/2] [UU]\n        resync=DELAYED\n");
    expect(pool!.work).toEqual({ what: "resync", percent: null, left: null });
  });
});

const ZPOOL = `  pool: tank
 state: DEGRADED
status: One or more devices could not be used because the label is missing or
\tinvalid.  Sufficient replicas exist for the pool to continue
\tfunctioning in a degraded state.
action: Replace the device using 'zpool replace'.
   see: https://openzfs.github.io/openzfs-docs/msg/ZFS-8000-4J
  scan: scrub repaired 0B in 00:00:01 with 2 errors on Sun Oct 25 10:00:01 2026
config:

\tNAME              STATE     READ WRITE CKSUM
\ttank              DEGRADED     0     0     0
\t  mirror-0        DEGRADED     0     0     0
\t    /dev/sdb5     ONLINE       0     0     3
\t    1234567890    UNAVAIL      0     0     0  was /dev/sdb6
\tcache
\t  /dev/sdc1       ONLINE       0     0     0
\tspares
\t  /dev/sdd1       AVAIL

errors: 1 data errors, use '-v' for a list

  pool: fast
 state: ONLINE
  scan: scrub in progress since Sun Oct 25 10:00:00 2026
\t1.23G / 4.56G scanned at 100M/s, 500M / 4.56G issued at 50M/s
\t0B repaired, 10.95% done, 00:01:23 to go
config:

\tNAME           STATE     READ WRITE CKSUM
\tfast           ONLINE       0     0     0
\t  /dev/nvme0n1p3  ONLINE       0     0     0

errors: No known data errors
`;

describe("ZFS", () => {
  const [tank, fast] = parseZpoolStatus(ZPOOL);
  test("a degraded mirror with a missing disk, its counters and the last scrub", () => {
    expect(tank).toMatchObject({ kind: "zfs", name: "tank", level: "mirror", state: "degraded", errors: 3, dataErrors: 1 });
    expect(tank!.members).toEqual([
      { path: "/dev/sdb5", state: "ok", errors: 3 },
      { path: "/dev/sdb6", state: "missing", errors: 0 },
      { path: "/dev/sdc1", state: "ok", errors: 0 },
      { path: "/dev/sdd1", state: "spare", errors: 0 },
    ]);
    expect(tank!.lastCheck).toEqual({ at: new Date(2026, 9, 25, 10, 0, 1).getTime(), errors: 2, unmended: 2 });
  });
  test("a single disk scrubbing", () => {
    expect(fast).toMatchObject({ level: "stripe", state: "ok", work: { what: "scrub", percent: 10.95, left: 2 } });
  });
  test("what a scrub mended", () => {
    const [pool] = parseZpoolStatus(ZPOOL.split("\n\n  pool: fast")[0]!.replace("repaired 0B in 00:00:01 with 2 errors", "repaired 31.9M in 00:00:10 with 0 errors"));
    expect(pool!.lastCheck).toMatchObject({ errors: 0, unmended: 0, mended: "31.9M" });
  });
  test("sizes", () => expect(parseZpoolList("tank\t1000\t400\nfast\t20\t5\n")).toEqual({ tank: { size: 1000, used: 400 }, fast: { size: 20, used: 5 } }));
});

const SHOW = `Label: 'pool'  uuid: 1c2b3c4d-0000-4000-8000-000000000001
\tTotal devices 2 FS bytes used 196608
\tdevid    1 size 4294967296 used 553648128 path /dev/sdb7
\tdevid    2 size 4294967296 used 553648128 path /dev/sdb8

Label: none  uuid: 1c2b3c4d-0000-4000-8000-000000000002
\tTotal devices 2 FS bytes used 1234
\tdevid    1 size 1073741824 used 0 path /dev/sdc3
\t*** Some devices missing

Label: 'one'  uuid: 1c2b3c4d-0000-4000-8000-000000000003
\tTotal devices 1 FS bytes used 10
\tdevid    1 size 100 used 0 path /dev/sda4

`;

describe("btrfs", () => {
  const all = parseBtrfsShow(SHOW);
  test("file systems and the device they miss", () => {
    expect(all.map((f) => [f.label, f.total, f.devices.length])).toEqual([["pool", 2, 2], ["", 2, 2], ["one", 1, 1]]);
    expect(all[1]!.devices[1]).toEqual({ id: 0, size: 0, path: "", missing: true });
  });
  test("a missing device named by newer programs", () => {
    const [fs] = parseBtrfsShow("Label: 'x'  uuid: 1c2b3c4d-0000-4000-8000-000000000009\n\tTotal devices 2 FS bytes used 1\n\tdevid    1 size 10 used 0 path /dev/sdb1\n\tdevid    2 size 0 used 0 path <missing disk> MISSING\n");
    expect(fs!.devices.map((d) => d.missing)).toEqual([false, true]);
  });
  test("profile, counters, scrub", () => {
    expect(parseBtrfsDf("Data, RAID1: total=1073741824, used=0\nSystem, RAID1: total=8388608, used=16384\n")).toBe("raid1");
    expect(parseBtrfsStats("[/dev/sdb7].write_io_errs    0\n[/dev/sdb7].read_io_errs     2\n[/dev/sdb7].corruption_errs  1\n[/dev/sdb8].write_io_errs    0\n")).toEqual({ "/dev/sdb7": 3, "/dev/sdb8": 0 });
    const done = parseBtrfsScrub("UUID:             x\nScrub started:    Sun Oct 25 10:00:00 2026\nStatus:           finished\nDuration:         0:01:00\nTotal to scrub:   1.00GiB\nError summary:    csum=2\n  Corrected:      1\n  Uncorrectable:  1\n  Unverified:     0\n");
    expect(done).toEqual({ work: null, last: { at: new Date(2026, 9, 25, 10, 1, 0).getTime(), errors: 2, unmended: 1 } });
    expect(parseBtrfsScrub("Scrub started:    Sun Oct 25 10:00:00 2026\nStatus:           running\nBytes scrubbed:   512.00MiB  (50.00%)\nTime left:        0:00:30\n").work).toEqual({ what: "scrub", percent: 50, left: 1 });
    expect(parseBtrfsScrub("UUID: x\n\tno stats available\n")).toEqual({ work: null, last: null });
  });
  test("as a pool: whole, degraded when mounted with a copy, failed when not mounted", () => {
    const none = { work: null, last: null };
    expect(btrfsPool(all[0]!, "/mnt/pool", "raid1", { "/dev/sdb7": 3 }, none)).toMatchObject({ id: "btrfs:1c2b3c4d-0000-4000-8000-000000000001", name: "pool", state: "ok", errors: 3, size: 8589934592, used: 196608 });
    expect(btrfsPool(all[1]!, "/mnt/x", "raid1", {}, none).state).toBe("degraded");
    expect(btrfsPool(all[1]!, "", "", {}, none).state).toBe("failed");
    expect(btrfsPool(all[1]!, "/mnt/x", "single", {}, none).state).toBe("failed");
  });
});

describe("attention", () => {
  test("one item per pool, the worst thing about it", () => {
    const pools = [...parseMdstat(MDSTAT), ...parseZpoolStatus(ZPOOL)];
    const items = poolTrouble(pools);
    expect(items.map((i) => [i.id, i.code, i.severity])).toEqual([
      ["raid:md:md1", "raid.failed", "danger"],
      ["raid:md:md2", "raid.failed", "danger"],
      ["raid:md:md3", "raid.degraded", "danger"],
      ["raid:zfs:tank", "raid.degraded", "danger"],
    ]);
    const rebuilding = parseMdstat("md7 : active raid1 sdb1[2] sda1[0]\n      100 blocks super 1.2 [2/1] [U_]\n      [==>...]  recovery = 12.6% (1/8) finish=3.0min speed=1K/sec\n");
    expect(poolTrouble(rebuilding)).toEqual([{ id: "raid:md:md7", severity: "warn", code: "raid.rebuilding", detail: { pool: "md7", kind: "md", id: "md:md7", percent: 12 } }]);
    expect(poolTrouble([{ ...pools[0]!, errors: 4 }])[0]).toMatchObject({ code: "raid.mismatch", severity: "warn" });
    expect(poolTrouble([{ ...parseZpoolStatus(ZPOOL)[1]!, errors: 4 }])[0]).toMatchObject({ code: "raid.errors" });
  });
});
