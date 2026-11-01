import { expect, test } from "bun:test";
import { serverTree, type MachineIn } from "../src/servertree";

const here = { name: "home", os: "Debian", address: "192.168.1.5", cpu: 10, memory: { used: 1, total: 2 }, uptime: 9 };
const machine = (over: Partial<MachineIn>): MachineIn => ({ id: "aa", name: "m", online: true, seen: 5, outdated: false, ip: "::ffff:192.168.1.9", info: { os: "Debian", arch: "x64", macs: [{}] }, status: { cpu: 7, memory: { used: 3, total: 4 }, uptime: 8 }, instance: "", guest: null, ...over });
const instance = (over = {}) => ({ name: "web", kind: "container", status: "running", os: "Debian 13", address: "10.0.0.2", memory: 1024, usage: { memory: 100 }, ...over });
const guest = (over = {}) => ({ id: "lxc/210", type: "lxc" as const, name: "git", status: "running", template: false, vmid: 210, cpu: 0.25, uptime: 3, memory: { used: 1, total: 2 }, config: { os: "debian", addresses: ["192.168.1.10"] }, may: { power: true, console: false }, ...over });
const host = (over = {}) => ({ id: "h1", name: "i5", version: "9.2", online: true, error: null, self: null, nodes: [{ cpu: 0.5, memory: { used: 1, total: 2 } }], guests: [guest()], unprotected: [], ...over });

test("a container with Hata's client is one row, under this server, with the machine's numbers", () => {
  const tree = serverTree({ here, instances: [instance()], hosts: [], machines: [machine({ instance: "web" })], version: "1" });
  expect(tree.groups.map((g) => g.kind)).toEqual(["here"]);
  expect(tree.groups[0]!.rows).toHaveLength(1);
  expect(tree.groups[0]!.rows[0]).toMatchObject({ name: "web", kind: "container", machine: "aa", connected: true, instance: "web", cpu: 7, memory: { used: 3, total: 4 } });
});

test("an instance without a client has only what Incus says, in bytes", () => {
  const row = serverTree({ here, instances: [instance()], hosts: [], machines: [], version: "1" }).groups[0]!.rows[0]!;
  expect(row).toMatchObject({ machine: "", cpu: null, memory: { used: 100, total: 1024 * 1024 * 1024 } });
});

test("a guest of Proxmox stands under its server; a template does not; a guest no job backs up is marked", () => {
  const tree = serverTree({ here, instances: [], hosts: [host({ guests: [guest(), guest({ id: "lxc/9", vmid: 9, name: "tmpl", template: true }), guest({ id: "qemu/5", vmid: 5, type: "qemu", name: "a-vm", status: "stopped" })], unprotected: [{ vmid: 5 }] })], machines: [machine({ guest: { host: "h1", id: "lxc/210" } })], version: "1" });
  const rows = tree.groups[1]!.rows;
  expect(rows.map((r) => r.name)).toEqual(["a-vm", "git"]);
  expect(rows[0]).toMatchObject({ kind: "vm", status: "stopped", noBackup: true, cpu: null, memory: null });
  expect(rows[1]).toMatchObject({ kind: "container", machine: "aa", cpu: 25, may: { power: true, console: false } });
  expect(tree.groups.some((g) => g.kind === "others")).toBe(false);
});

test("the other computers are the machines nothing else claims; nothing is counted twice", () => {
  const tree = serverTree({ here, instances: [instance()], hosts: [host()], machines: [machine({ instance: "web" }), machine({ id: "bb", name: "nas", online: false, status: null }), machine({ id: "cc", name: "pi", outdated: true })], version: "1" });
  expect(tree.groups.at(-1)).toMatchObject({ kind: "others", counts: { running: 1, all: 2 } });
  expect(tree.groups.at(-1)!.rows.map((r) => [r.name, r.status, r.address])).toEqual([["nas", "away", "192.168.1.9"], ["pi", "running", "192.168.1.9"]]);
  expect(tree).toMatchObject({ total: 4, running: 3, notConnected: 1, notAnswering: 0, outdated: [{ id: "cc", name: "pi" }] });
});

test("a Proxmox server that does not answer still stands in the tree and is counted", () => {
  const tree = serverTree({ here, instances: [], hosts: [host({ online: false, error: { code: "pve.away" }, guests: [] })], machines: [], version: "1" });
  expect(tree.groups[1]).toMatchObject({ online: false, error: "pve.away", rows: [] });
  expect(tree.notAnswering).toBe(1);
});

test("Hata's own guest is marked", () => {
  const tree = serverTree({ here, instances: [], hosts: [host({ self: "lxc/210" })], machines: [], version: "1" });
  expect(tree.groups[1]!.rows[0]!.self).toBe(true);
});
