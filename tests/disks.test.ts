import { expect, test } from "bun:test";
import { attention } from "../src/attention";
import { healthOf, parseLsblk, parseMounts, parseSmart, remember, verdict, type DiskReport, type Smart } from "../src/disks";
import { keyOf } from "../src/notify";
import type { SystemStatus } from "../src/system";

const GB = 1024 ** 3;

test("parseLsblk: disks with their partitions, without loop, zram and optical devices", () => {
  const disks = parseLsblk({
    blockdevices: [
      { name: "loop0", path: "/dev/loop0", type: "loop", size: 4096 },
      { name: "zram0", path: "/dev/zram0", type: "disk", size: 8 * GB, mountpoints: ["[SWAP]"] },
      { name: "sr0", path: "/dev/sr0", type: "rom", size: 1024 },
      {
        name: "sda",
        path: "/dev/sda",
        type: "disk",
        size: 4000 * GB,
        model: "WDC WD40EFRX-68N32N0 ",
        serial: "WD-1",
        tran: "sata",
        rota: true,
        rm: false,
        hotplug: false,
        fstype: null,
        mountpoints: [null],
        children: [
          { name: "sda1", path: "/dev/sda1", type: "part", size: 4000 * GB, fstype: "ext4", label: "data", mountpoints: ["/DATA", "/DATA"], fssize: 3900 * GB, fsused: 100 * GB },
          { name: "sda2", path: "/dev/sda2", type: "part", size: GB, fstype: "swap", label: null, mountpoints: ["[SWAP]"], fssize: null, fsused: null },
        ],
      },
      {
        name: "nvme0n1",
        path: "/dev/nvme0n1",
        type: "disk",
        size: 250 * GB,
        model: "Samsung SSD 980",
        serial: "S1",
        tran: "nvme",
        rota: false,
        rm: false,
        children: [
          {
            name: "nvme0n1p2",
            path: "/dev/nvme0n1p2",
            type: "part",
            size: 249 * GB,
            fstype: "crypto_LUKS",
            mountpoints: [null],
            children: [{ name: "root", path: "/dev/mapper/root", type: "crypt", size: 249 * GB, fstype: "ext4", mountpoints: ["/"], fssize: 240 * GB, fsused: 90 * GB }],
          },
        ],
      },
      // a stick formatted whole, as lsblk of an older util-linux prints it: strings and one mount point
      { name: "sdb", type: "disk", size: "16000000000", model: "Cruzer", serial: "", tran: "usb", rota: "0", rm: "1", fstype: "exfat", label: "STICK", mountpoint: "/mnt/stick", fssize: "15000000000", fsused: "1000" },
    ],
  });
  expect(disks.map((d) => d.name)).toEqual(["sda", "nvme0n1", "sdb"]);
  expect(disks[0]).toMatchObject({ model: "WDC WD40EFRX-68N32N0", transport: "sata", rotational: true, removable: false });
  expect(disks[0]!.volumes).toMatchObject([
    { name: "sda1", path: "/dev/sda1", kind: "part", size: 4000 * GB, fstype: "ext4", label: "data", mounts: ["/DATA"], total: 3900 * GB, used: 100 * GB },
    { name: "sda2", path: "/dev/sda2", kind: "part", size: GB, fstype: "swap", label: "", mounts: [], total: null, used: null },
  ]);
  // what is stacked on a partition is listed next to it
  expect(disks[1]!.volumes.map((v) => [v.name, v.kind, v.mounts[0] ?? ""])).toEqual([["nvme0n1p2", "part", ""], ["root", "crypt", "/"]]);
  expect(disks[2]).toMatchObject({ path: "/dev/sdb", removable: true, rotational: false, size: 16000000000 });
  expect(disks[2]!.volumes).toMatchObject([{ name: "sdb", path: "/dev/sdb", kind: "disk", size: 16000000000, fstype: "exfat", label: "STICK", mounts: ["/mnt/stick"], total: 15000000000, used: 1000 }]);
  expect(parseLsblk(null)).toEqual([]);
  expect(parseLsblk({})).toEqual([]);
});

test("parseMounts keeps the file systems that hold files, each once", () => {
  const mounts = parseMounts(
    [
      "proc /proc proc rw,nosuid 0 0",
      "tmpfs /run tmpfs rw 0 0",
      "/dev/sda2 / ext4 rw,relatime 0 0",
      "/dev/sda1 /boot/efi vfat rw 0 0",
      "overlay /var/lib/docker/overlay2/abc/merged overlay rw 0 0",
      "/dev/sdb1 /mnt/My\\040Disk ext4 ro,relatime 0 0",
      "/dev/sdb1 /srv/again ext4 ro,relatime 0 0",
      "//nas/media /mnt/media cifs rw 0 0",
      "nas:/export /mnt/nfs nfs4 rw 0 0",
      "user@host:/ /mnt/ssh fuse.sshfs rw 0 0",
      "tank/data /tank/data zfs rw 0 0",
      "",
    ].join("\n"),
  );
  expect(mounts).toEqual([
    { device: "/dev/sda2", path: "/", fstype: "ext4", readOnly: false, network: false },
    { device: "/dev/sdb1", path: "/mnt/My Disk", fstype: "ext4", readOnly: true, network: false },
    { device: "//nas/media", path: "/mnt/media", fstype: "cifs", readOnly: false, network: true },
    { device: "nas:/export", path: "/mnt/nfs", fstype: "nfs4", readOnly: false, network: true },
    { device: "user@host:/", path: "/mnt/ssh", fstype: "sshfs", readOnly: false, network: true },
    { device: "tank/data", path: "/tank/data", fstype: "zfs", readOnly: false, network: false },
  ]);
});

const attr = (id: number, name: string, raw: number, value = 100) => ({ id, name, value, worst: value, thresh: 0, raw: { value: raw, string: String(raw) } });

test("parseSmart: a SATA disk", () => {
  const smart = parseSmart({
    smart_status: { passed: true },
    rotation_rate: 5400,
    temperature: { current: 36 },
    power_on_time: { hours: 27810 },
    power_cycle_count: 120,
    ata_smart_attributes: { table: [attr(5, "Reallocated_Sector_Ct", 8), attr(197, "Current_Pending_Sector", 2), attr(198, "Offline_Uncorrectable", 0), attr(199, "UDMA_CRC_Error_Count", 3)] },
    ata_smart_self_test_log: { standard: { table: [{ type: { value: 1, string: "Short offline" }, status: { value: 0, string: "Completed without error", passed: true }, lifetime_hours: 27800 }] } },
    ata_smart_data: { self_test: { status: { value: 0, string: "completed without error", passed: true } } },
  });
  expect(smart).toEqual({ passed: true, temperature: 36, powerOnHours: 27810, powerCycles: 120, reallocated: 8, pending: 2, uncorrectable: 0, crc: 3, mediaErrors: null, wear: null, spare: null, critical: false, lastTest: { type: "short", passed: true, hours: 27800 }, testing: null });
});

test("parseSmart: wear of a SATA SSD, a test that is running, a test that failed", () => {
  const ssd = parseSmart({
    smart_status: { passed: true },
    rotation_rate: 0,
    ata_smart_attributes: { table: [attr(177, "Wear_Leveling_Count", 412, 93)] },
    ata_smart_data: { self_test: { status: { value: 249, string: "in progress, 90% remaining", remaining_percent: 90 } } },
    ata_smart_self_test_log: { standard: { table: [{ type: { string: "Extended offline" }, status: { value: 112, string: "Completed: read failure", passed: false }, lifetime_hours: 10 }] } },
  })!;
  expect(ssd.wear).toBe(7);
  expect(ssd.testing).toBe(90);
  expect(ssd.lastTest).toEqual({ type: "long", passed: false, hours: 10 });
  // the same attribute on a spinning disk means something else
  expect(parseSmart({ smart_status: { passed: true }, rotation_rate: 7200, ata_smart_attributes: { table: [attr(177, "Wear_Leveling_Count", 1, 50)] } })!.wear).toBeNull();
});

test("parseSmart: an NVMe drive", () => {
  const smart = parseSmart({
    smart_status: { passed: true },
    temperature: { current: 41 },
    power_on_time: { hours: 900 },
    power_cycle_count: 50,
    nvme_smart_health_information_log: { critical_warning: 0, temperature: 41, available_spare: 100, available_spare_threshold: 10, percentage_used: 3, power_cycles: 50, power_on_hours: 900, media_errors: 0 },
    nvme_self_test_log: { current_self_test_operation: { value: 1, string: "Short self-test in progress" }, current_self_test_completion_percent: 30, table: [{ self_test_code: { value: 1, string: "Short" }, self_test_result: { value: 0, string: "Completed without error" }, power_on_hours: 800 }] },
  });
  expect(smart).toEqual({ passed: true, temperature: 41, powerOnHours: 900, powerCycles: 50, reallocated: null, pending: null, uncorrectable: null, crc: null, mediaErrors: 0, wear: 3, spare: { left: 100, threshold: 10 }, critical: false, lastTest: { type: "short", passed: true, hours: 800 }, testing: 70 });
});

test("parseSmart: nothing to read is null", () => {
  expect(parseSmart(null)).toBeNull();
  expect(parseSmart({ smartctl: { exit_status: 4 }, device: { name: "/dev/sda" }, smart_support: { available: false } })).toBeNull();
});

const healthy: Smart = { passed: true, temperature: 35, powerOnHours: 1000, powerCycles: 10, reallocated: 0, pending: 0, uncorrectable: 0, crc: 4, mediaErrors: null, wear: null, spare: null, critical: false, lastTest: null, testing: null };

test("verdict: what counts against a disk", () => {
  expect(verdict(healthy, true)).toEqual([]);
  expect(healthOf(verdict(healthy, true))).toBe("ok");
  expect(healthOf(null)).toBe("unknown");

  const wearing = verdict({ ...healthy, reallocated: 8, pending: 2 }, true);
  expect(wearing).toEqual([{ code: "reallocated", severity: "warn", n: 8 }, { code: "pending", severity: "warn", n: 2 }]);
  expect(healthOf(wearing)).toBe("warn");

  expect(healthOf(verdict({ ...healthy, passed: false }, true))).toBe("danger");
  expect(verdict({ ...healthy, lastTest: { type: "long", passed: false, hours: 5 } }, true)).toEqual([{ code: "test", severity: "danger" }]);
  expect(verdict({ ...healthy, critical: true, spare: { left: 4, threshold: 10 }, mediaErrors: 12, wear: 97 }, false).map((f) => f.code)).toEqual(["critical", "spare", "media", "worn"]);
  // flash runs hotter than a spinning disk may
  expect(verdict({ ...healthy, temperature: 58 }, true)).toEqual([{ code: "hot", severity: "warn", n: 58 }]);
  expect(verdict({ ...healthy, temperature: 58 }, false)).toEqual([]);
});

test("attention: one line per disk in trouble, about the worst it reports", () => {
  const system: SystemStatus = { hostname: "h", uptime: 1, cores: 4, load: [0, 0, 0], cpu: 5, memory: { total: 16 * GB, used: 4 * GB, swapTotal: 0, swapUsed: 0 }, disks: [], net: null, temperature: 45, history: { cpu: [], memory: [], net: [] } };
  const disk = (name: string, model: string, smart: Smart | null): DiskReport => {
    const findings = smart ? verdict(smart, true) : null;
    return { name, path: "/dev/" + name, model, serial: model && "S-" + name, size: GB, transport: "sata", rotational: true, removable: false, volumes: [], smart, health: healthOf(findings), findings: findings ?? [], checkedAt: 1 };
  };
  const items = attention({
    system,
    docker: { available: true },
    apps: [],
    activity: [],
    disks: [disk("sda", "WD Red", healthy), disk("sdb", "Seagate", { ...healthy, reallocated: 8, passed: false }), disk("sdc", "", { ...healthy, pending: 3 }), disk("sdd", "QEMU", null)],
  });
  expect(items).toEqual([
    { id: "smart:S-sdb", severity: "danger", code: "smart.failing", detail: { disk: "Seagate", n: 0 } },
    { id: "smart:sdc", severity: "warn", code: "smart.pending", detail: { disk: "sdc", n: 3 } },
  ]);
});

const reading = (patch: Partial<Smart> = {}): Smart => ({ passed: true, temperature: 30, powerOnHours: 100, powerCycles: 5, reallocated: 0, pending: 0, uncorrectable: 0, crc: 0, mediaErrors: null, wear: null, spare: null, critical: false, lastTest: null, testing: null, ...patch });
const DAY = 24 * 3600_000;

test("remember: a counter is logged when first seen and at every change, and its growth is news once a day", () => {
  let record = remember(undefined, reading(), 1000);
  expect(record.log.reallocated).toEqual([{ at: 1000, value: 0 }]);
  expect(record.log.mediaErrors).toBeUndefined();
  expect(record.grew).toBeUndefined();

  record = remember(record, reading(), 2000);
  expect(record.log.reallocated).toHaveLength(1);
  expect(record.at).toBe(2000);

  record = remember(record, reading({ reallocated: 8 }), 3000);
  expect(record.log.reallocated).toEqual([
    { at: 1000, value: 0 },
    { at: 3000, value: 8 },
  ]);
  expect(record.grew).toBe(3000);

  // the same day: logged, but not news again
  record = remember(record, reading({ reallocated: 9, pending: 2 }), 4000);
  expect(record.log.reallocated).toHaveLength(3);
  expect(record.grew).toBe(3000);

  record = remember(record, reading({ reallocated: 200, pending: 2 }), 3000 + DAY);
  expect(record.grew).toBe(3000 + DAY);
});

test("remember: a disk that came with bad sectors is no news, nor is a cable, nor a counter that fell", () => {
  let record = remember(undefined, reading({ reallocated: 8 }), 1000);
  expect(record.grew).toBeUndefined();
  record = remember(record, reading({ reallocated: 8, crc: 40 }), 2000);
  expect(record.log.crc).toHaveLength(2);
  expect(record.grew).toBeUndefined();
  record = remember(record, reading({ reallocated: 8, crc: 40, pending: 3 }), 3000);
  expect(record.grew).toBe(3000);
  record = remember(record, reading({ reallocated: 8, crc: 40, pending: 0 }), 3000 + 2 * DAY);
  expect(record.log.pending!.at(-1)).toEqual({ at: 3000 + 2 * DAY, value: 0 });
  expect(record.grew).toBe(3000);
});

test("remember: the hottest reading is kept, a reading without data keeps the history, the log does not grow without end", () => {
  let record = remember(undefined, reading({ temperature: 40 }), 1000);
  record = remember(record, reading({ temperature: 51 }), 2000);
  record = remember(record, reading({ temperature: 44 }), 3000);
  expect(record.hottest).toEqual({ at: 2000, value: 51 });
  record = remember(record, null, 4000);
  expect(record.smart).toBeNull();
  expect(record.hottest?.value).toBe(51);
  expect(record.log.reallocated).toHaveLength(1);
  for (let i = 1; i <= 100; i++) record = remember(record, reading({ reallocated: i }), 4000 + i);
  expect(record.log.reallocated).toHaveLength(40);
  expect(record.log.reallocated![0]).toEqual({ at: 1000, value: 0 });
  expect(record.log.reallocated!.at(-1)!.value).toBe(100);
});

test("attention: a counter that grew makes the disk's item news again", () => {
  const system = { cpu: { percent: 0 }, memory: { total: 0, used: 0 }, disks: [], temperature: null } as unknown as SystemStatus;
  const disk = (grew: number | null) => ({ name: "sda", model: "WD Red", serial: "WD-1", findings: [{ code: "reallocated", severity: "warn", n: 8 }], grew }) as unknown as DiskReport;
  const item = (grew: number | null) => attention({ system, docker: { available: true } as never, apps: [], activity: [], disks: [disk(grew)] })[0]!;
  expect(item(null).at).toBeUndefined();
  expect(keyOf(item(null))).toBe("smart:WD-1");
  expect(keyOf(item(5000))).toBe("smart:WD-1@5000");
});
