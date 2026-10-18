import { expect, test } from "bun:test";
import { rolesFor } from "../src/proxmox";
import { clientLine, gibOf, readSettings, restoreParams, settingsChange, cleanSchedule, scheduleDue, scheduled, toPrune, SCHEDULE_MARK, readOffered, TEMPLATE_RE, archOf, readRrd, cloneParams, readVersions, versionCompare, readContent } from "../src/pve";
import { cleanFingerprint, cleanUrl, failed, hostKeysIn, familyOf, nextId, readNewGuest, setupScript, guestOfMachine, guestRights, mayPath, readConfig, readResources, readTask, snapshotName, trouble, type Watched } from "../src/pve";

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
  expect(guestRights(perms, g[0]!)).toEqual({ power: false, snapshot: false, rollback: false, backup: false, remove: false, console: false, configure: false, cpu: false, memory: false, disk: false, clone: false });
  expect(guestRights(perms, g[1]!)).toEqual({ power: true, snapshot: true, rollback: false, backup: false, remove: false, console: false, configure: false, cpu: false, memory: false, disk: false, clone: false });
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
  // what /status answers: no end time at all
  const ended = readTask({ upid: "UPID:i5:1", status: "stopped", exitstatus: "WARNINGS: 1", starttime: 100 })!;
  expect(ended.end).toBeGreaterThan(0);
  expect(failed(ended)).toBe(false);
  expect(readTask({ upid: "UPID:i5:1", status: "running", starttime: 100 })!.end).toBeNull();
});

const watched = (over: Partial<Watched> = {}): Watched => {
  const r = readResources(resources);
  return { id: "abcd1234", name: "i5", error: null, ...r, configs: {}, tasks: [], disks: [], unprotected: [], ips: {}, ...over };
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

test("a machine is found among the guests by its card or its address", () => {
  const w = watched({ configs: { "qemu/233": { macs: ["bc:24:11:aa:bb:cc"], addresses: [], onboot: true, unprivileged: false, os: "l26", description: "" }, "lxc/218": { macs: ["bc:24:11:00:00:01"], addresses: ["192.168.1.218"], onboot: true, unprivileged: true, os: "debian", description: "" } }, ips: { "lxc/900": ["192.168.1.120"] } });
  expect(guestOfMachine([w], ["BC:24:11:AA:BB:CC"], "")?.guest.vmid).toBe(233);
  expect(guestOfMachine([w], [], "192.168.1.218")?.guest.vmid).toBe(218);
  expect(guestOfMachine([w], [], "192.168.1.120")?.guest.vmid).toBe(900);
  expect(guestOfMachine([w], ["00:00:00:00:00:01"], "192.168.1.5")).toBeNull();
  expect(guestOfMachine([w], [], "")).toBeNull();
});

test("a snapshot's default name", () => {
  expect(snapshotName(new Date(2026, 9, 17, 22, 5))).toBe("hata-20261017-2205");
});

const offer = { nodes: ["i5"], templates: { i5: ["local:vztmpl/debian-13-standard_13.6-1_amd64.tar.zst", "local:vztmpl/alpine-3.22-default_20250617_amd64.tar.xz"] }, storages: { i5: ["local-lvm"] }, bridges: { i5: ["vmbr0"] }, pools: ["hata"], free: false, ids: { from: 243, to: 252 }, taken: [243, 210] };
const answers = { node: "i5", vmid: 244, hostname: "Docker-1", template: "local:vztmpl/debian-13-standard_13.6-1_amd64.tar.zst", storage: "local-lvm", disk: 4, cores: 2, memory: 1024, bridge: "vmbr0", address: "dhcp", pool: "hata", docker: true };

test("a new container's answers become Proxmox's parameters", () => {
  const g = readNewGuest(answers, offer);
  expect(g.hostname).toBe("docker-1");
  expect(g.family).toBe("apt");
  expect(g.docker).toBe(true);
  expect(g.address).toBeNull();
  expect(g.params).toEqual({ vmid: 244, hostname: "docker-1", ostemplate: answers.template, rootfs: "local-lvm:4", cores: 2, memory: 1024, swap: 512, net0: "name=eth0,bridge=vmbr0,ip=dhcp", unprivileged: 1, pool: "hata" });
  expect(g.later).toEqual({ features: "nesting=1", onboot: 1, tags: "hata", description: "Made by Hata" });
  const fixed = readNewGuest({ ...answers, address: "192.168.1.244/24", gateway: "192.168.1.1", onboot: false }, offer);
  expect(fixed.address).toBe("192.168.1.244");
  expect(fixed.params.net0).toBe("name=eth0,bridge=vmbr0,ip=192.168.1.244/24,gw=192.168.1.1");
  expect(fixed.later.onboot).toBe(0);
});

test("a new container's answers refused field by field", () => {
  const field = (over: Record<string, unknown>, o = offer) => {
    try {
      readNewGuest({ ...answers, ...over }, o);
      return "";
    } catch (e) {
      return (e as { field: string }).field;
    }
  };
  expect(field({ vmid: 243 })).toBe("vmidTaken");
  expect(field({ vmid: 260 })).toBe("vmidRange");
  expect(field({ hostname: "-x" })).toBe("hostname");
  expect(field({ template: "local:vztmpl/other.tar.zst" })).toBe("template");
  expect(field({ template: offer.templates.i5[1] })).toBe("templateNoClient");
  expect(field({ template: offer.templates.i5[1], client: false })).toBe("");
  expect(field({ pool: "" })).toBe("pool");
  expect(field({ pool: "" }, { ...offer, free: true })).toBe("");
  expect(field({ address: "192.168.1.300/24", gateway: "192.168.1.1" })).toBe("address");
  expect(field({ address: "192.168.1.50/24" })).toBe("gateway");
  expect(field({ disk: 1 })).toBe("disk");
  expect(field({ storage: "local" })).toBe("storage");
});

test("the next free number, in the range when there is one", () => {
  expect(nextId({ ids: { from: 243, to: 252 }, taken: [243, 244] })).toBe(245);
  expect(nextId({ ids: { from: 243, to: 244 }, taken: [243, 244] })).toBeNull();
  expect(nextId({ ids: null, taken: [100, 101, 210] })).toBe(102);
  expect(familyOf("local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst")).toBe("apt");
  expect(familyOf("local:vztmpl/rockylinux-9-default_20240912_amd64.tar.xz")).toBe("dnf");
  expect(familyOf("local:vztmpl/alpine-3.22-default_20250617_amd64.tar.xz")).toBeNull();
});

test("the setup script takes Hata's key out whatever happens", () => {
  const script = setupScript({ family: "apt", docker: false, client: true }, "curl -fsSL http://h/client/c | sh", "ssh-ed25519 AAAAkey hata-setup");
  expect(script.split("\n")[0]).toBe(`trap "sed -i '\\|AAAAkey|d' /root/.ssh/authorized_keys" EXIT`);
  expect(script).toContain("apt-get install -y -q curl ca-certificates\ncurl -fsSL http://h/client/c | sh\n");
  expect(script).not.toContain("get.docker.com");
});

test("a new container's key fingerprints from the task's lines", () => {
  expect(hostKeysIn(["Creating SSH host key 'ssh_host_ed25519_key' - this may take some time ...", "done: SHA256:Q/PWaZvdCe2vZ/p5Dp+7eTp8sqhZyaFeISPWoC6igWs root@hata-ct1", "done: nothing"])).toEqual(["SHA256:Q/PWaZvdCe2vZ/p5Dp+7eTp8sqhZyaFeISPWoC6igWs"]);
});

test("the rights Hata gives its own token, by level", () => {
  expect(rolesFor("read")).toEqual([["/", "PVEAuditor"]]);
  expect(rolesFor("pool")).toEqual([["/", "PVEAuditor"], ["/pool/hata", "PVEVMAdmin"], ["/storage", "PVEDatastoreUser"], ["/sdn/zones", "PVESDNUser"]]);
  expect(rolesFor("manage")[1]).toEqual(["/vms", "PVEVMAdmin"]);
});

test("the client's line per system", () => {
  expect(clientLine("debian", "http://h/", "c")).toBe("export DEBIAN_FRONTEND=noninteractive; apt-get update -q && apt-get install -y -q curl ca-certificates && curl -fsSL http://h/client/c | sh");
  expect(clientLine("alpine", "http://h", "c")).toBeNull();
  expect(clientLine("l26", "http://h", "c")).toBe("curl -fsSL http://h/client/c | sh");
});

test("a guest's settings read from its configuration", () => {
  const ct = readSettings({ hostname: "web", cores: 2, memory: 1024, swap: 256, onboot: 1, tags: "hata;web", description: "Notes\n", rootfs: "local-lvm:vm-243-disk-0,size=4G", mp0: "local-lvm:vm-243-disk-1,mp=/data,size=512M", mp1: "/srv/media,mp=/media" }, "lxc");
  expect(ct).toEqual({ name: "web", cores: 2, memory: 1024, swap: 256, onboot: true, tags: ["hata", "web"], description: "Notes\n", disks: [{ key: "rootfs", storage: "local-lvm", size: 4 }, { key: "mp0", storage: "local-lvm", size: 0.5 }] });
  const vm = readSettings({ name: "win", cores: 4, memory: "current=8192", scsi0: "local-lvm:vm-100-disk-0,iothread=1,size=1T", ide2: "local:iso/debian.iso,media=cdrom,size=600M", efidisk0: "local-lvm:vm-100-disk-1,size=4M" }, "qemu");
  expect(vm.memory).toBe(8192);
  expect(vm.swap).toBeNull();
  expect(vm.onboot).toBe(false);
  expect(vm.disks).toEqual([{ key: "scsi0", storage: "local-lvm", size: 1024 }]);
  expect(gibOf("32G")).toBe(32);
  expect(gibOf("nonsense")).toBe(0);
});

test("a guest's settings changed: only what differs, with the rights it needs", () => {
  const old = readSettings({ hostname: "web", cores: 2, memory: 1024, swap: 256, onboot: 1, tags: "hata", description: "x", rootfs: "local-lvm:vm-243-disk-0,size=4G" }, "lxc");
  expect(settingsChange(old, { name: "web", cores: 2, memory: 1024, onboot: true, tags: ["hata"], description: "x", disks: { rootfs: 4 } }, "lxc")).toEqual({ params: {}, remove: [], grow: [], needs: [] });
  expect(settingsChange(old, { name: "web2", cores: "4", memory: 2048, swap: 0, onboot: false, tags: [], description: "", disks: { rootfs: 8 } }, "lxc")).toEqual({
    params: { hostname: "web2", cores: 4, memory: 2048, swap: 0, onboot: 0 },
    remove: ["tags", "description"],
    grow: [{ disk: "rootfs", size: "8G" }],
    needs: ["options", "cpu", "memory", "disk"],
  });
  const field = (input: Record<string, unknown>) => {
    try {
      settingsChange(old, input, "lxc");
      return "";
    } catch (e) {
      return (e as { field: string }).field;
    }
  };
  expect(field({ name: "-bad" })).toBe("name");
  expect(field({ cores: 0 })).toBe("cores");
  expect(field({ memory: 10 })).toBe("memory");
  expect(field({ tags: ["ok", "not ok"] })).toBe("tags");
  expect(field({ disks: { rootfs: 3 } })).toBe("diskShrink");
  expect(field({ disks: { mp9: 10 } })).toBe("disk");
  expect(field({ onboot: "yes" })).toBe("onboot");
  // a virtual machine's name may have dots, and has no swap
  const vm = readSettings({ name: "vm", cores: 1, memory: 2048 }, "qemu");
  expect(settingsChange(vm, { name: "vm.home", swap: 512 }, "qemu").params).toEqual({ name: "vm.home" });
});

test("a backup restored over its guest or as a new one", () => {
  const volid = "local:backup/vzdump-lxc-243-2026_10_18-10_00_00.tar.zst";
  expect(restoreParams("lxc", { volid, vmid: 243, storage: "local-lvm", replace: true, pool: "hata" })).toEqual({ vmid: 243, ostemplate: volid, restore: 1, storage: "local-lvm", force: 1 });
  expect(restoreParams("lxc", { volid, vmid: 245, storage: "local-lvm", replace: false, pool: "hata" })).toEqual({ vmid: 245, ostemplate: volid, restore: 1, storage: "local-lvm", unique: 1, pool: "hata" });
  expect(restoreParams("qemu", { volid: "local:backup/vzdump-qemu-245.vma.zst", vmid: 246, storage: "", replace: false, pool: "" })).toEqual({ vmid: 246, archive: "local:backup/vzdump-qemu-245.vma.zst", unique: 1 });
});

test("Hata's schedule of backups: checked, due once a day, keeps only its own copies", () => {
  expect(cleanSchedule({ on: true, time: "03:30", storage: "local", keep: 3, guests: [245, 243, 243] }, ["local"])).toEqual({ on: true, time: "03:30", storage: "local", keep: 3, guests: [243, 245] });
  expect(cleanSchedule({ on: false, time: "03:30", storage: "gone", keep: 1, guests: "all" }, ["local"]).storage).toBe("");
  const field = (input: Record<string, unknown>) => {
    try {
      cleanSchedule({ on: true, time: "03:30", storage: "local", keep: 3, guests: "all", ...input }, ["local"]);
      return "";
    } catch (e) {
      return (e as { field: string }).field;
    }
  };
  expect(field({ time: "25:00" })).toBe("time");
  expect(field({ storage: "nas" })).toBe("storage");
  expect(field({ keep: 0 })).toBe("keep");
  expect(field({ guests: [] })).toBe("guests");
  expect(field({ guests: ["x"] })).toBe("guests");
  const s = cleanSchedule({ on: true, time: "03:30", storage: "local", keep: 2, guests: "all" }, ["local"]);
  const at = (h: number, m: number) => new Date(2026, 9, 18, h, m);
  expect(scheduleDue(s, undefined, at(3, 29))).toBe(false);
  expect(scheduleDue(s, undefined, at(3, 30))).toBe(true);
  expect(scheduleDue(s, "2026-10-17", at(23, 0))).toBe(true);
  expect(scheduleDue(s, "2026-10-18", at(23, 0))).toBe(false);
  expect(scheduleDue({ ...s, on: false }, undefined, at(4, 0))).toBe(false);
  expect(scheduled(s, [243, 245])).toEqual([243, 245]);
  expect(scheduled({ ...s, guests: [243, 999] }, [243, 245])).toEqual([243]);
  const b = (volid: string, vmid: number, at: number, notes: string, isProtected = false) => ({ volid, vmid, at, notes, protected: isProtected });
  expect(
    toPrune([b("a1", 243, 1, `ct ${SCHEDULE_MARK}`), b("a2", 243, 2, `ct ${SCHEDULE_MARK}`), b("a3", 243, 3, `ct ${SCHEDULE_MARK}`), b("m", 243, 0, "ct — Hata"), b("p", 243, 0, `ct ${SCHEDULE_MARK}`, true), b("c1", 245, 5, `x ${SCHEDULE_MARK}`)], 2),
  ).toEqual(["a1"]);
});

test("the templates Proxmox offers: systems first, newest first", () => {
  const list = readOffered([
    { type: "lxc", section: "turnkeylinux", template: "debian-12-turnkey-xoops_18.0-1_amd64.tar.gz", headline: "TurnKey Xoops", os: "debian-12", version: "18.0-1" },
    { type: "lxc", section: "system", template: "debian-12-standard_12.12-1_amd64.tar.zst", headline: "Debian 12", os: "debian-12", version: "12.12-1" },
    { type: "lxc", section: "system", template: "alpine-3.22-default_20250617_amd64.tar.xz", headline: "Alpine 3.22", os: "alpine", version: "3.22" },
    { type: "qemu", section: "system", template: "x.qcow2" },
  ]);
  expect(readOffered([{ type: "lxc", template: "alpine-arm.tar.xz", architecture: "arm64" }, { type: "lxc", template: "alpine.tar.xz", architecture: "amd64" }], "amd64").map((t) => t.template)).toEqual(["alpine.tar.xz"]);
  expect(archOf({ cpuinfo: { flags: "fpu sse sse2 lm" } })).toBe("amd64");
  expect(archOf({ cpuinfo: { flags: "fp asimd evtstrm" } })).toBe("arm64");
  expect(archOf({})).toBe("");
  expect(list.map((t) => [t.template, t.client])).toEqual([
    ["alpine-3.22-default_20250617_amd64.tar.xz", false],
    ["debian-12-standard_12.12-1_amd64.tar.zst", true],
    ["debian-12-turnkey-xoops_18.0-1_amd64.tar.gz", true],
  ]);
  expect(TEMPLATE_RE.test("debian-12-standard_12.12-1_amd64.tar.zst")).toBe(true);
  expect(TEMPLATE_RE.test("../etc/passwd.tar.gz")).toBe(false);
});

test("load over time: a node's and a guest's fields, gaps kept", () => {
  expect(readRrd([{ time: 20, cpu: 0.5, memused: 4, memtotal: 8, netin: 10, netout: 2 }, { time: 10, cpu: 0.1, mem: 1, maxmem: 2 }, { time: 30 }])).toEqual([
    { t: 10_000, cpu: 0.1, mem: 1, maxmem: 2, netin: null, netout: null },
    { t: 20_000, cpu: 0.5, mem: 4, maxmem: 8, netin: 10, netout: 2 },
    { t: 30_000, cpu: null, mem: null, maxmem: null, netin: null, netout: null },
  ]);
});

test("a clone: full by default, linked only as asked, storage only for a full one", () => {
  expect(cloneParams("lxc", { newid: 246, name: "web-2", linked: false, storage: "local-lvm", pool: "hata" })).toEqual({ newid: 246, hostname: "web-2", full: 1, storage: "local-lvm", pool: "hata" });
  expect(cloneParams("qemu", { newid: 247, name: "vm-2", linked: true, storage: "local-lvm", pool: "" })).toEqual({ newid: 247, name: "vm-2", full: 0 });
});

test("a node's versions: newer packages, a newer kernel waiting for a restart", () => {
  expect(versionCompare("7.0.14-24", "7.0.14-20")).toBe(1);
  expect(versionCompare("10.6.1-1+pve3", "10.6.1-1+pve10")).toBe(-1);
  expect(versionCompare("9.2.0", "9.2.0")).toBe(0);
  const list = [
    { Package: "proxmox-ve", OldVersion: "9.2.0", Version: "9.2.0", CurrentState: "Installed", RunningKernel: "7.0.14-20-pve" },
    { Package: "pve-manager", OldVersion: "9.2.21", Version: "9.2.21", CurrentState: "Installed" },
    { Package: "proxmox-kernel-7.0", OldVersion: "7.0.14-20", Version: "7.0.14-24", CurrentState: "Installed" },
    { Package: "proxmox-kernel-7.0.14-20-pve-signed", OldVersion: "7.0.14-20", Version: "7.0.14-20", CurrentState: "Installed" },
    { Package: "proxmox-kernel-7.0.14-8-pve-signed", OldVersion: "7.0.14-8", Version: "7.0.14-8", CurrentState: "Installed" },
    { Package: "qemu-server", OldVersion: "9.2.10", Version: "9.2.11", CurrentState: "Installed" },
    { Package: "zfsutils-linux", OldVersion: "", Version: "2.3.4", CurrentState: "NotInstalled" },
  ];
  expect(readVersions(list)).toEqual({ manager: "9.2.21", running: "7.0.14-20-pve", newest: "7.0.14-20-pve", reboot: false, newer: [{ name: "proxmox-kernel-7.0", from: "7.0.14-20", to: "7.0.14-24" }, { name: "qemu-server", from: "9.2.10", to: "9.2.11" }] });
  const waiting = readVersions([...list, { Package: "proxmox-kernel-7.0.14-24-pve-signed", OldVersion: "7.0.14-24", Version: "7.0.14-24", CurrentState: "Installed" }]);
  expect(waiting.newest).toBe("7.0.14-24-pve");
  expect(waiting.reboot).toBe(true);
});

test("what a storage holds: whose it is, what is left of guests that are gone", () => {
  const list = readContent(
    [
      { volid: "local-lvm:vm-243-disk-0", content: "rootdir", size: 5e9, vmid: 243 },
      { volid: "local-lvm:vm-199-disk-0", content: "images", size: 8e9, vmid: "199" },
      { volid: "local:iso/debian.iso", content: "iso", size: 6e8 },
    ],
    new Map([[243, "hata-ct1"]]),
  );
  expect(list.map((v) => [v.volid, v.guest, v.orphan])).toEqual([
    ["local-lvm:vm-199-disk-0", "", true],
    ["local-lvm:vm-243-disk-0", "hata-ct1", false],
    ["local:iso/debian.iso", "", false],
  ]);
});
