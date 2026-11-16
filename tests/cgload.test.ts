import { describe, expect, test } from "bun:test";
import { addSample, classify, parsePasswd, loadWarn, memoryInUse, minutesOver, parseCpuStat, parseIoStat, parseNetDev, rowsOf, type GroupCounters } from "../src/cgload";

const ID = "a".repeat(64);
const ID2 = "b".repeat(64);

describe("reading the kernel's counters", () => {
  test("cpu.stat, memory, io.stat, net/dev", () => {
    expect(parseCpuStat("usage_usec 98309166\nuser_usec 73785600\n")).toBe(98309166);
    expect(parseCpuStat("")).toBeNull();
    expect(memoryInUse("anon 500\nfile 9000\nshmem 200\ninactive_file 300\n")).toBe(700);
    expect(memoryInUse("")).toBe(0);
    expect(parseIoStat("8:16 rbytes=10 wbytes=0 rios=1\n8:0 rbytes=5 wbytes=7 rios=2\n")).toEqual({ read: 15, write: 7 });
    const dev = "Inter-|   Receive\n face |bytes\n    lo: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0\n  eth0: 100 1 0 0 0 0 0 0 50 1 0 0 0 0 0 0\n";
    expect(parseNetDev(dev)).toEqual({ rx: 100, tx: 50 });
  });

  test("what a group is", () => {
    expect(classify(`system.slice/docker-${ID}.scope`)).toEqual({ key: `docker:${ID}`, kind: "container", name: ID });
    expect(classify(`docker/${ID}`)?.kind).toBe("container");
    expect(classify("system.slice/hata.service")?.kind).toBe("hata");
    expect(classify("system.slice/hata-copy-0123abcd.service")?.key).toBe("hata");
    expect(classify("system.slice/containerd.service")?.key).toBe("engine");
    expect(classify("system.slice/smbd.service")).toEqual({ key: "svc:smbd", kind: "service", name: "smbd" });
    expect(classify("lxc.payload.web")).toEqual({ key: "incus:web", kind: "instance", name: "web" });
    expect(classify("user.slice/user-996.slice")).toEqual({ key: "user:996", kind: "sessions", name: "996" });
    expect(classify("user.slice")).toBeNull();
    expect(classify("init.scope")?.kind).toBe("system");
    expect(classify("system.slice/boot-efi.mount")).toBeNull();
    expect(classify("dev-hugepages.mount")).toBeNull();
    expect(classify("system.slice/docker.socket")).toBeNull();
  });
});

describe("rows", () => {
  const g = (path: string, cpu: number, extra: Partial<GroupCounters> = {}): GroupCounters => ({ path, cpu, memory: 100, read: 0, write: 0, rx: null, tx: null, ...extra });

  test("rates, apps made of their containers, the rest", () => {
    const before = [g("system.slice/hata.service", 0), g(`system.slice/docker-${ID}.scope`, 0, { rx: 0, tx: 0 }), g(`system.slice/docker-${ID2}.scope`, 0, { rx: 0, tx: 0 }), g("system.slice/docker.service", 0), g("system.slice/containerd.service", 0)];
    // 5 s, 2 cores: 10 s of processor time is the whole machine
    const now = [g("system.slice/hata.service", 1_000_000, { write: 5000 }), g(`system.slice/docker-${ID}.scope`, 2_000_000, { rx: 500, tx: 50 }), g(`system.slice/docker-${ID2}.scope`, 1_000_000, { rx: 500, tx: 0 }), g("system.slice/docker.service", 1_000_000), g("system.slice/containerd.service", 500_000), g("system.slice/new.service", 9_000_000)];
    const names = new Map([[ID, { project: "memos", service: "web", name: "memos-web-1" }], [ID2, { project: "memos", service: "db", name: "memos-db-1" }]]);
    const rows = rowsOf(before, now, 5000, 2, names, { cpu: 80, memory: 1000 });
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.hata!.cpu).toBe(10);
    expect(by.hata!.write).toBe(1000);
    expect(by["app:memos"]!.cpu).toBe(30);
    expect(by["app:memos"]!.rx).toBe(200);
    expect(by["app:memos"]!.memory).toBe(200);
    expect(by["app:memos"]!.parts!.map((p) => p.name)).toEqual(["web", "db"]);
    expect(by.engine!.cpu).toBe(15);
    // a group the first walk did not see waits for the next
    expect(by["svc:new"]).toBeUndefined();
    expect(by.rest!.cpu).toBe(25);
    expect(by.rest!.memory).toBe(500);
    expect(rows[0]!.key).toBe("app:memos");
  });

  test("sessions by their user; the TV's player is the TV", () => {
    const users = parsePasswd("root:x:0:0:root:/root:/bin/bash\nhata-tv:x:996:996::/var/lib/hata-tv:/usr/sbin/nologin\n");
    const rows = rowsOf([g("user.slice/user-0.slice", 0), g("user.slice/user-996.slice", 0)], [g("user.slice/user-0.slice", 100), g("user.slice/user-996.slice", 100)], 5000, 1, new Map(), null, users);
    expect(rows.map((r) => [r.key, r.kind, r.name]).sort()).toEqual([["svc:hata-tv", "service", "hata-tv"], ["user:0", "sessions", "root"]]);
  });

  test("a container of no project is a row of its own, named", () => {
    const rows = rowsOf([g(`docker/${ID}`, 0)], [g(`docker/${ID}`, 500_000)], 5000, 1, new Map([[ID, { name: "adminer" }]]));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("adminer");
    expect(rows[0]!.cpu).toBe(10);
  });
});

describe("the hour", () => {
  const M = 60_000;
  test("minutes averaged, gaps kept, minutes over a limit", () => {
    let h = addSample(undefined, 0, 90, 10);
    h = addSample(h, 30_000, 70, 30);
    h = addSample(h, M, 85, 0);
    expect(h.cpu).toEqual([80]);
    expect(h.memory).toEqual([20]);
    h = addSample(h, 4 * M, 95, 0);
    expect(h.cpu).toEqual([80, 85, null, null]);
    expect(minutesOver(h, 80)).toBe(0);
    h = addSample(h, 5 * M, 95, 0);
    h = addSample(h, 6 * M, 10, 0);
    expect(minutesOver(h, 80)).toBe(2);
    expect(minutesOver(h, 96)).toBe(0);
    for (let i = 7; i < 100; i++) h = addSample(h, i * M, 1, 0);
    expect(h.cpu).toHaveLength(60);
  });

  test("the warning's settings", () => {
    expect(loadWarn({ cpu: 90, minutes: 15, warn: false })).toEqual({ cpu: 90, minutes: 15, warn: false });
    expect(loadWarn({ cpu: 10 })).toBeNull();
    expect(loadWarn({ minutes: 61 })).toBeNull();
    expect(loadWarn({ warn: "yes" })).toBeNull();
    expect(loadWarn(null)).toBeNull();
  });
});
