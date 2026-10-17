import { expect, test } from "bun:test";
import { cleanFingerprint, cleanUrl, guestOfMacs, guestRights, mayPath, readConfig, readResources, readTask, snapshotName, trouble, type Watched } from "../src/pve";

test("an address as typed becomes the API's origin", () => {
  expect(cleanUrl("192.168.1.198")).toBe("https://192.168.1.198:8006");
  expect(cleanUrl("pve:8006/")).toBe("https://pve:8006");
  expect(cleanUrl("https://pve.example.com")).toBe("https://pve.example.com");
  expect(cleanUrl("https://192.168.1.198:8006/#v1:0:18:4")).toBe("https://192.168.1.198:8006");
  expect(cleanUrl("http://pve:8006")).toBeNull();
  expect(cleanUrl("https://user:pw@pve")).toBeNull();
  expect(cleanUrl("https://pve/api2/json")).toBeNull();
  expect(cleanUrl("pve 8006")).toBeNull();
  expect(cleanUrl(42)).toBeNull();
});

test("a fingerprint in any spelling", () => {
  const fp = "C2:58:18:5E:77:B1:A8:D1:6F:BE:AD:59:DC:B4:32:2B:34:F3:C6:53:A6:91:E2:2C:82:42:E5:AD:1A:35:75:2D";
  expect(cleanFingerprint(fp.toLowerCase().replace(/:/g, ""))).toBe(fp);
  expect(cleanFingerprint(fp)).toBe(fp);
  expect(cleanFingerprint("C2:58")).toBeNull();
});

const resources = [
  { id: "node/i5", type: "node", node: "i5", status: "online", cpu: 0.4, maxcpu: 4, mem: 9e9, maxmem: 16e9, disk: 48e9, maxdisk: 72e9, uptime: 9928 },
  { id: "lxc/218", type: "lxc", vmid: 218, name: "hata-live", node: "i5", status: "running", template: 0, tags: "dev;hata", maxcpu: 2, mem: 1.2e8, maxmem: 4.2e9, disk: 2.5e9, maxdisk: 1.6e10, uptime: 9791 },
  { id: "qemu/233", type: "qemu", vmid: 233, name: "hata-disks", node: "i5", status: "stopped", template: 0, pool: "hata", disk: 0, maxdisk: 3e10 },
  { id: "lxc/900", type: "lxc", vmid: 900, name: "base", node: "i5", status: "stopped", template: 1 },
  { id: "storage/i5/local-lvm", type: "storage", node: "i5", storage: "local-lvm", plugintype: "lvmthin", status: "available", content: "images,rootdir", disk: 79, maxdisk: 100, shared: 0 },
  { id: "storage/i5/nas", type: "storage", node: "i5", storage: "nas", plugintype: "nfs", status: "unknown", content: "backup,iso", shared: 1 },
  { id: "sdn/i5/localnetwork", type: "sdn", node: "i5" },
];

test("the cluster's resources are read into nodes, guests and storages", () => {
  const r = readResources(resources);
  expect(r.nodes).toEqual([{ name: "i5", online: true, cpu: 0.4, cores: 4, memory: { used: 9e9, total: 16e9 }, disk: { used: 48e9, total: 72e9 }, uptime: 9928 }]);
  expect(r.guests.map((g) => g.id)).toEqual(["lxc/218", "qemu/233", "lxc/900"]);
  expect(r.guests[0]!.tags).toEqual(["dev", "hata"]);
  expect(r.guests[1]!.disk).toEqual({ used: 0, total: 3e10 });
  expect(r.guests[2]!.template).toBe(true);
  expect(r.storages.map((s) => [s.id, s.active, s.shared])).toEqual([["i5/local-lvm", true, false], ["i5/nas", false, true]]);
});

test("a guest's configuration gives its cards and addresses", () => {
  expect(readConfig({ net0: "name=eth0,bridge=vmbr0,hwaddr=BC:24:11:AA:BB:CC,ip=192.168.1.218/24,gw=192.168.1.1,type=veth", net1: "name=eth1,bridge=vmbr0,hwaddr=BC:24:11:00:00:01,ip=dhcp", onboot: 1, unprivileged: 1, ostype: "debian" })).toEqual({
    macs: ["bc:24:11:aa:bb:cc", "bc:24:11:00:00:01"],
    addresses: ["192.168.1.218"],
    onboot: true,
    unprivileged: true,
    os: "debian",
    description: "",
  });
  const vm = readConfig({ net0: "virtio=BC:24:11:12:34:56,bridge=vmbr0,firewall=1", ipconfig0: "ip=10.0.0.5/24,gw=10.0.0.1", ostype: "l26" });
  expect(vm.macs).toEqual(["bc:24:11:12:34:56"]);
  expect(vm.addresses).toEqual(["10.0.0.5"]);
  expect(vm.onboot).toBe(false);
});

test("rights: the most specific path that gives something", () => {
  const perms = { "/": { "VM.Audit": 1 }, "/pool/hata": { "VM.PowerMgmt": 1, "VM.Snapshot": 1 }, "/storage/local-lvm": { "Datastore.AllocateSpace": 1 } };
  const g = readResources(resources).guests;
  expect(guestRights(perms, g[0]!)).toEqual({ power: false, snapshot: false, rollback: false, backup: false });
  expect(guestRights(perms, g[1]!)).toEqual({ power: true, snapshot: true, rollback: false, backup: false });
  expect(guestRights({ "/": { "VM.PowerMgmt": 1 } }, g[0]!).power).toBe(true);
  expect(mayPath(perms, "/storage/local-lvm", "Datastore.AllocateSpace")).toBe(true);
  expect(mayPath(perms, "/storage/local", "Datastore.AllocateSpace")).toBe(false);
});

test("tasks: running, done, failed", () => {
  expect(readTask({ upid: "UPID:i5:0001:02:6700:vzdump:218:root@pam:", node: "i5", type: "vzdump", id: "218", user: "root@pam", starttime: 100, status: "running" })!.status).toBe("");
  expect(readTask({ upid: "UPID:i5:1", node: "i5", type: "vzstart", starttime: 100, endtime: 105, status: "OK" })!.end).toBe(105);
  expect(readTask({ upid: "x" })).toBeNull();
  // a task's own /status says stopped and puts the result in exitstatus
  expect(readTask({ upid: "UPID:i5:1", status: "stopped", exitstatus: "command failed", endtime: 9 })!.status).toBe("command failed");
});

const watched = (over: Partial<Watched> = {}): Watched => {
  const r = readResources(resources);
  return { id: "abcd1234", name: "i5", error: null, ...r, configs: {}, tasks: [], disks: [], unprotected: [], ...over };
};

test("a quiet server is worth no word", () => {
  expect(trouble(watched())).toEqual([]);
});

test("a server away, a token refused, a certificate changed", () => {
  const now = 10_000_000;
  expect(trouble(watched({ error: { code: "pve.unreachable", since: now - 60_000 } }), now)).toEqual([]);
  expect(trouble(watched({ error: { code: "pve.unreachable", since: now - 6 * 60_000 } }), now).map((i) => i.code)).toEqual(["pve.away"]);
  expect(trouble(watched({ error: { code: "pve.badToken", since: now } }), now).map((i) => i.code)).toEqual(["pve.badToken"]);
  expect(trouble(watched({ error: { code: "pve.certChanged", since: now } }), now).map((i) => i.code)).toEqual(["pve.certChanged"]);
});

test("a full storage, a guest that should run, a failed backup, a sick disk, guests without backups", () => {
  const now = 1_000_000_000_000;
  const s = now / 1000;
  const items = trouble(
    watched({
      configs: { "qemu/233": { macs: [], addresses: [], onboot: true, unprivileged: false, os: "", description: "" } },
      tasks: [
        { upid: "UPID:a", node: "i5", type: "vzdump", id: "218", user: "root@pam", start: s - 7200, end: s - 7100, status: "job errors" },
        { upid: "UPID:b", node: "i5", type: "vzdump", id: "210", user: "root@pam", start: s - 7200, end: s - 7100, status: "job errors" },
        { upid: "UPID:c", node: "i5", type: "vzdump", id: "210", user: "root@pam", start: s - 3600, end: s - 3500, status: "OK" },
        { upid: "UPID:d", node: "i5", type: "vzdump", id: "212", user: "root@pam", start: s - 90000, end: s - 89000, status: "job errors" },
      ],
      disks: [{ node: "i5", device: "/dev/sda", model: "Samsung", health: "PASSED" }, { node: "i5", device: "/dev/sdb", model: "WD", health: "FAILED" }],
      unprotected: [{ vmid: 218, name: "hata-live" }],
    }),
    now,
  );
  expect(items.map((i) => [i.code, i.severity])).toEqual([
    ["pve.guestDown", "warn"],
    ["pve.backupFailed", "danger"],
    ["pve.diskHealth", "danger"],
    ["pve.notBackedUp", "warn"],
  ]);
  expect(items[1]!.detail.guest).toBe("hata-live");
  expect(items[1]!.at).toBe((s - 7100) * 1000);
  const full = trouble(watched({ storages: [{ id: "i5/local-lvm", name: "local-lvm", node: "i5", type: "lvmthin", active: true, shared: false, content: [], used: 96, total: 100 }] }));
  expect(full.map((i) => [i.code, i.severity, i.detail.percent])).toEqual([["pve.storageFull", "danger", 96]]);
});

test("an offline node: its guests and storages are not judged", () => {
  const r = readResources(resources);
  const items = trouble(watched({ nodes: r.nodes.map((n) => ({ ...n, online: false })), configs: { "qemu/233": { macs: [], addresses: [], onboot: true, unprivileged: false, os: "", description: "" } } }));
  expect(items.map((i) => i.code)).toEqual(["pve.nodeOffline"]);
});

test("a machine is found among the guests by its card", () => {
  const w = watched({ configs: { "lxc/218": { macs: ["bc:24:11:aa:bb:cc"], addresses: [], onboot: true, unprivileged: true, os: "debian", description: "" } } });
  expect(guestOfMacs([w], ["BC:24:11:AA:BB:CC"])?.guest.vmid).toBe(218);
  expect(guestOfMacs([w], ["00:00:00:00:00:01"])).toBeNull();
  expect(guestOfMacs([w], [])).toBeNull();
});

test("a snapshot's default name", () => {
  expect(snapshotName(new Date(2026, 9, 17, 22, 5))).toBe("hata-20261017-2205");
});
