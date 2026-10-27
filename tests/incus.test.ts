import { expect, test } from "bun:test";
import { bridgeRules, configOf, devicesOf, FieldError, placeFor, poolName, insideNarrowMap, limitsChange, megabytes, readInstance, readNew, setupScript, snapshotName } from "../src/incus";

const field = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return e instanceof FieldError ? e.field : "other";
  }
  return "";
};

test("a new container is read and checked", () => {
  const c = readNew({ name: " Docker-1 ", image: "debian-13", cores: 2, memory: 1024, docker: true }, []);
  expect(c).toMatchObject({ name: "docker-1", cores: 2, memory: 1024, autostart: true, docker: true, client: true });
  expect(c.image.alias).toBe("debian/13");
  expect(field(() => readNew({ name: "1abc", image: "debian-13" }, []))).toBe("name");
  expect(field(() => readNew({ name: "a--b", image: "debian-13" }, []))).toBe("name");
  expect(field(() => readNew({ name: "web", image: "debian-13" }, ["web"]))).toBe("taken");
  expect(field(() => readNew({ name: "web", image: "arch" }, []))).toBe("image");
  expect(field(() => readNew({ name: "web", image: "debian-13", memory: 64 }, []))).toBe("memory");
  expect(field(() => readNew({ name: "web", image: "debian-13", cores: 1.5 }, []))).toBe("cores");
  // no client without systemd, and Docker only comes with it
  expect(readNew({ name: "tiny", image: "alpine-3.22", docker: true }, [])).toMatchObject({ client: false, docker: false });
  expect(readNew({ name: "plain", image: "debian-12", client: false, docker: true }, [])).toMatchObject({ client: false, docker: false });
});

test("a container's settings", () => {
  expect(configOf({ cores: 2, memory: 512, autostart: true, docker: true })).toEqual({ "boot.autostart": "true", "user.hata": "true", "limits.cpu": "2", "limits.memory": "512MiB", "security.nesting": "true" });
  expect(configOf({ cores: 0, memory: 0, autostart: false })).toEqual({ "boot.autostart": "false", "user.hata": "true" });
});

test("only what differs changes, and a limit taken away is an empty value", () => {
  const now = { "limits.cpu": "2", "limits.memory": "1024MiB", "boot.autostart": "true", "security.nesting": "true" };
  expect(limitsChange({ cores: 2, memory: 1024, autostart: true, nesting: true }, now)).toEqual({});
  expect(limitsChange({ cores: 0, memory: 2048, autostart: false, nesting: false }, now)).toEqual({ "limits.cpu": "", "limits.memory": "2048MiB", "boot.autostart": "false", "security.nesting": "" });
  // a container made elsewhere has no autostart key: "off" is what it is already
  expect(limitsChange({ cores: 0, memory: 0, autostart: false }, {})).toEqual({});
  expect(field(() => limitsChange({ cores: -1 }, {}))).toBe("cores");
});

test("sizes in megabytes", () => {
  expect(megabytes("512MiB")).toBe(512);
  expect(megabytes("2GiB")).toBe(2048);
  expect(megabytes("1GB")).toBe(954);
  expect(megabytes("1073741824")).toBe(1024);
  expect(megabytes(undefined)).toBe(0);
  expect(megabytes("50%")).toBe(0);
});

test("an instance as Incus gives it", () => {
  const raw = {
    name: "t1",
    type: "container",
    status: "Running",
    created_at: "2026-10-27T16:20:00Z",
    config: { "image.os": "debian", "image.release": "trixie", "limits.cpu": "2", "limits.memory": "1GiB", "boot.autostart": "true", "user.hata": "true", "volatile.eth0.hwaddr": "10:66:6A:AA:BB:CC" },
    state: {
      memory: { usage: 26 * 1024 * 1024 },
      cpu: { usage: 5 },
      processes: 12,
      disk: {},
      network: {
        docker0: { type: "broadcast", hwaddr: "02:42:00:00:00:01", addresses: [{ family: "inet", address: "172.17.0.1", scope: "global" }] },
        lo: { type: "loopback", addresses: [{ family: "inet", address: "127.0.0.1", scope: "local" }] },
        eth0: { type: "broadcast", hwaddr: "10:66:6a:aa:bb:cc", addresses: [{ family: "inet6", address: "fe80::1", scope: "link" }, { family: "inet", address: "10.254.231.206", scope: "global" }] },
      },
    },
    snapshots: [
      { name: "t1/a", created_at: "2026-10-27T17:00:00Z" },
      { name: "t1/b", created_at: "2026-10-27T18:00:00Z" },
    ],
  };
  const c = readInstance(raw)!;
  expect(c).toMatchObject({ name: "t1", status: "running", os: "Debian trixie", cores: 2, memory: 1024, autostart: true, nesting: false, ours: true, address: "10.254.231.206", mac: "10:66:6a:aa:bb:cc" });
  expect(c.usage?.memory).toBe(26 * 1024 * 1024);
  expect(c.snapshots.map((s) => s.name)).toEqual(["b", "a"]);
  expect(readInstance({ ...raw, status: "Stopped", state: null })!.usage).toBeNull();
  expect(readInstance({ ...raw, type: "virtual-machine" })!.kind).toBe("vm");
  expect(readInstance({ ...raw, type: "image" })).toBeNull();
});

test("inside a container with part of the user ids", () => {
  expect(insideNarrowMap("         0          0 4294967295\n")).toBe(false);
  expect(insideNarrowMap("         0     100000      65536\n")).toBe(true);
  expect(insideNarrowMap("0 1000000 1000000000")).toBe(true);
  expect(insideNarrowMap("")).toBe(false);
});

test("the bridge's rules and the setup inside", () => {
  expect(bridgeRules("hatabr0")).toEqual([
    ["-i", "hatabr0", "-j", "ACCEPT"],
    ["-o", "hatabr0", "-m", "conntrack", "--ctstate", "RELATED,ESTABLISHED", "-j", "ACCEPT"],
  ]);
  const script = setupScript({ docker: true, client: true }, "curl -fsSL http://10.0.0.1:80/client/x | sh");
  expect(script).toContain("get.docker.com");
  expect(script.trim().split("\n").pop()).toBe("curl -fsSL http://10.0.0.1:80/client/x | sh");
  expect(setupScript({ docker: false, client: true }, "line")).not.toContain("docker");
});

test("a snapshot's name", () => {
  expect(snapshotName("before-update")).toBe("before-update");
  expect(snapshotName("", new Date(2026, 9, 27, 9, 5, 7))).toBe("snap-20261027-090507");
  expect(field(() => snapshotName("a/b"))).toBe("snapshot");
});

test("a virtual machine: only the images tried as one, a disk of its own, no nesting", () => {
  const v = readNew({ kind: "vm", name: "vm1", image: "debian-13", cores: 2, memory: 2048, disk: 20, docker: true }, []);
  expect(v).toMatchObject({ kind: "vm", disk: 20, docker: true, client: true });
  expect(readNew({ kind: "vm", name: "vm2", image: "debian-13" }, []).disk).toBe(10);
  expect(readNew({ name: "ct", image: "debian-13", disk: 50 }, []).disk).toBe(0);
  expect(field(() => readNew({ kind: "vm", name: "vm3", image: "ubuntu-24.04" }, []))).toBe("image");
  expect(field(() => readNew({ kind: "vm", name: "vm4", image: "debian-13", disk: 2 }, []))).toBe("disk");
  expect(configOf({ ...v, kind: "vm" })).toEqual({ "boot.autostart": "true", "user.hata": "true", "limits.cpu": "2", "limits.memory": "2048MiB", "security.secureboot": "false" });
  expect(devicesOf(v, "default")).toEqual({ root: { type: "disk", path: "/", pool: "default", size: "20GiB" } });
  expect(devicesOf({ kind: "container", disk: 0 }, "disk1")).toEqual({ root: { type: "disk", path: "/", pool: "disk1" } });
  expect(readInstance({ name: "vm1", type: "virtual-machine", status: "Stopped", config: {} })!.kind).toBe("vm");
});

test("the names the page's routes take are refused", () => {
  for (const name of ["install", "setup", "vms"]) expect(field(() => readNew({ name, image: "debian-13" }, []))).toBe("name");
});

test("a container's or virtual machine's snapshots are a folder of their own, also in the second copy", async () => {
  const { BACKUP_KEY_RE } = await import("../src/backup");
  const { isCopyFolder } = await import("../src/remote");
  for (const key of ["box1@incus", "nextcloud", "app@0a1b2c3d"]) {
    expect(BACKUP_KEY_RE.test(key)).toBe(true);
    expect(isCopyFolder(key)).toBe(true);
  }
  for (const key of ["box1@lxd", "box1@", "@incus"]) expect(BACKUP_KEY_RE.test(key)).toBe(false);
});

test("a folder as a place for containers", () => {
  const uses = { mounts: [{ path: "/", fstype: "ext4" }, { path: "/mnt/disk1", fstype: "btrfs" }, { path: "/mnt/usb", fstype: "exfat" }, { path: "/mnt/net/nas", fstype: "cifs" }, { path: "/mnt/storage", fstype: "fuse.mergerfs" }], dataRoot: "/DATA", backupDir: "/DATA/Backups", state: ["/var/lib/hata", "/etc/hata"], pools: ["/srv/ct"] };
  expect(placeFor("/mnt/disk1/containers/", uses)).toEqual({ path: "/mnt/disk1/containers", driver: "btrfs", fstype: "btrfs" });
  expect(placeFor("/srv/other", uses)).toEqual({ path: "/srv/other", driver: "dir", fstype: "ext4" });
  const error = (p: string) => (placeFor(p, uses) as { error?: string }).error;
  expect(error("relative")).toBe("containers.place.bad");
  expect(error("/mnt/../etc")).toBe("containers.place.bad");
  expect(error("/etc/incus")).toBe("containers.place.system");
  expect(error("/")).toBe("containers.place.system");
  expect(error("/var/lib/hata/ct")).toBe("containers.place.state");
  expect(error("/DATA/ct")).toBe("containers.place.data");
  expect(error("/srv/ct/inner")).toBe("containers.place.taken");
  expect(error("/srv")).toBe("containers.place.taken");
  for (const p of ["/mnt/usb/ct", "/mnt/net/nas/ct", "/mnt/storage/ct"]) expect(error(p)).toBe("containers.place.fs");
});

test("a place's name", () => {
  expect(poolName("/mnt/disk1/containers", [])).toBe("disk1");
  expect(poolName("/mnt/disk1/containers", ["disk1"])).toBe("disk1-2");
  expect(poolName("/srv/Фото", [])).toBe("srv");
});
