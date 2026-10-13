import { expect, test } from "bun:test";
import { cleanChange, dhcpcdClientId, withoutIface, handBackScript, handedFile, parseLinks, profileArgs, terse, udevRule, waitOnline } from "../src/network";

const ADDR = JSON.stringify([
  { ifname: "lo", link_type: "loopback", flags: ["LOOPBACK", "UP", "LOWER_UP"], addr_info: [{ family: "inet", local: "127.0.0.1", prefixlen: 8 }] },
  {
    ifname: "eth0",
    link_type: "ether",
    address: "bc:24:11:b6:3a:39",
    flags: ["BROADCAST", "MULTICAST", "UP", "LOWER_UP"],
    addr_info: [
      { family: "inet", local: "192.168.1.233", prefixlen: 24, scope: "global", dynamic: true },
      { family: "inet6", local: "fe80::1", prefixlen: 64, scope: "link" },
      { family: "inet6", local: "2001:db8::5", prefixlen: 64, scope: "global" },
    ],
  },
  { ifname: "enp2s0", link_type: "ether", address: "aa:bb:cc:dd:ee:ff", flags: ["NO-CARRIER", "BROADCAST", "UP"], addr_info: [] },
  { ifname: "docker0", link_type: "ether", flags: ["UP", "LOWER_UP"], addr_info: [{ family: "inet", local: "172.17.0.1", prefixlen: 16 }] },
  { ifname: "veth0330f59", link_type: "ether", flags: ["UP", "LOWER_UP"] },
  { ifname: "wg0", link_type: "none", flags: ["UP", "LOWER_UP"] },
]);
const ROUTE = JSON.stringify([{ dst: "default", gateway: "192.168.1.1", dev: "eth0" }]);

test("parseLinks: the server's own interfaces, without Docker's and tunnels", () => {
  expect(parseLinks(ADDR, ROUTE)).toEqual([
    { name: "eth0", mac: "bc:24:11:b6:3a:39", up: true, addresses: ["192.168.1.233/24"], addresses6: ["2001:db8::5/64"], dynamic: true, gateway: "192.168.1.1" },
    { name: "enp2s0", mac: "aa:bb:cc:dd:ee:ff", up: false, addresses: [], addresses6: [], dynamic: false, gateway: "" },
  ]);
  expect(parseLinks("not json", "")).toEqual([]);
});

test("terse: nmcli's fields, with the colons of a value escaped", () => {
  expect(terse("eth0:connected:hata-eth0")).toEqual(["eth0", "connected", "hata-eth0"]);
  expect(terse("GENERAL.HWADDR:BC\\:24\\:11\\:B6\\:3A\\:39")).toEqual(["GENERAL.HWADDR", "BC:24:11:B6:3A:39"]);
  expect(terse("a\\\\b:")).toEqual(["a\\b", ""]);
});

test("cleanChange: a fixed address with its gateway and DNS", () => {
  expect(cleanChange({ method: "manual", address: " 192.168.1.10/24 ", gateway: "192.168.1.1", dns: "192.168.1.1, 1.1.1.1" })).toEqual({ method: "manual", address: "192.168.1.10/24", gateway: "192.168.1.1", dns: ["192.168.1.1", "1.1.1.1"] });
  expect(cleanChange({ method: "manual", address: "10.0.0.5/8", gateway: "", dns: [] })).toEqual({ method: "manual", address: "10.0.0.5/8", gateway: "", dns: [] });
  expect(cleanChange({ method: "auto", address: "whatever", dns: "" })).toEqual({ method: "auto", address: "", gateway: "", dns: [] });
});

test("cleanChange: what cannot be an address of a machine is refused", () => {
  const bad = (address: string) => cleanChange({ method: "manual", address, gateway: "", dns: "" });
  for (const address of ["192.168.1.10", "192.168.1.0/24", "192.168.1.255/24", "192.168.1.300/24", "192.168.1.10/31", "192.168.1.10/4", "127.0.0.5/8", "224.0.0.5/24", "0.1.2.3/24", "::1/64", "1.2.3.4/24; reboot"]) expect(bad(address)).toBe("network.badAddress");
  expect(cleanChange({ method: "manual", address: "192.168.1.10/24", gateway: "192.168.2.1", dns: "" })).toBe("network.badGateway");
  expect(cleanChange({ method: "manual", address: "192.168.1.10/24", gateway: "192.168.1.10", dns: "" })).toBe("network.badGateway");
  expect(cleanChange({ method: "auto", dns: "1.1.1.1 8.8.8.8 9.9.9.9 4.4.4.4" })).toBe("network.badDns");
  expect(cleanChange({ method: "auto", dns: "dns.example" })).toBe("network.badDns");
  expect(cleanChange({ method: "static" })).toBe("network.badMethod");
});

test("profileArgs: every setting is written, so the previous ones do not linger", () => {
  expect(profileArgs({ method: "manual", address: "192.168.1.10/24", gateway: "192.168.1.1", dns: ["1.1.1.1"] })).toEqual(["ipv4.method", "manual", "ipv4.addresses", "192.168.1.10/24", "ipv4.gateway", "192.168.1.1", "ipv4.dns", "1.1.1.1", "ipv4.ignore-auto-dns", "no"]);
  expect(profileArgs({ method: "auto", address: "", gateway: "", dns: [] })).toEqual(["ipv4.method", "auto", "ipv4.addresses", "", "ipv4.gateway", "", "ipv4.dns", "", "ipv4.ignore-auto-dns", "no"]);
  expect(profileArgs({ method: "auto", address: "", gateway: "", dns: ["9.9.9.9"] }).slice(-3)).toEqual(["9.9.9.9", "ipv4.ignore-auto-dns", "yes"]);
});

test("a hand-over: networkd is told to leave the interface, udev to let NetworkManager have it, the boot not to wait", () => {
  expect(handedFile("eth0")).toContain("[Match]\nName=eth0\n\n[Link]\nUnmanaged=yes\n");
  expect(udevRule("eth0")).toContain('KERNEL=="eth0", ENV{NM_UNMANAGED}="0"');
  expect(waitOnline(["eth0"], [])).toContain("ExecStart=\nExecStart=/bin/true\n");
  expect(waitOnline(["eth0", "eth1"], ["eth2"])).toContain("ExecStart=\nExecStart=/lib/systemd/systemd-networkd-wait-online --any --ignore=eth0 --ignore=eth1\n");
  const undo = handBackScript("eth0");
  expect(undo).toContain("rm -f /etc/systemd/network/00-hata-eth0.network /etc/udev/rules.d/99-zz-hata-eth0.rules");
  expect(undo).toContain("nmcli connection delete hata-eth0");
  expect(undo.trimEnd().endsWith("networkctl reconfigure eth0")).toBe(true);
});

test("withoutIface: the interface is commented out of /etc/network/interfaces, the rest stays as written", () => {
  const text = ["# The loopback network interface", "auto lo", "iface lo inet loopback", "", "# The primary network interface", "allow-hotplug enp3s0", "iface enp3s0 inet dhcp", "\tdns-nameservers 1.1.1.1", "", "auto eth1 enp3s0", "iface eth1 inet static", "\taddress 10.0.0.2/24", "iface enp3s0 inet6 auto", ""].join("\n");
  expect(withoutIface(text, "enp3s0")).toBe(["# The loopback network interface", "auto lo", "iface lo inet loopback", "", "# The primary network interface", "#hata# allow-hotplug enp3s0", "#hata# iface enp3s0 inet dhcp", "#hata# \tdns-nameservers 1.1.1.1", "", "#hata# auto eth1 enp3s0", "auto eth1", "iface eth1 inet static", "\taddress 10.0.0.2/24", "#hata# iface enp3s0 inet6 auto", ""].join("\n"));
  expect(withoutIface(text, "wlan0")).toBeNull();
  expect(withoutIface("source /etc/network/interfaces.d/*\nauto enp3s0\n", "enp3s0")).toBeNull();
});

test("dhcpcdClientId: the name dhcpcd gave the router, for NetworkManager to give too", () => {
  expect(dhcpcdClientId("40:8D:5C:33:B9:0F", "00:01:00:01:32:60:b9:d2:40:8d:5c:33:b9:0f\n")).toBe("ff:5c:33:b9:0f:00:01:00:01:32:60:b9:d2:40:8d:5c:33:b9:0f");
  expect(dhcpcdClientId("40:8d:5c:33:b9:0f", "")).toBe("");
  expect(dhcpcdClientId("", "00:01:00:01")).toBe("");
});
