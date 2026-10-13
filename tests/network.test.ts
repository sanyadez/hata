import { expect, test } from "bun:test";
import { cleanChange, checkConf, parseConnectivity, hotspotProfile, parseLeases, wifiQrText, isModem, roleArgs, parseWifi, wifiPassword, wifiProfile, wifiProfileId, dhcpcdClientId, withoutIface, handBackScript, handedFile, parseLinks, profileArgs, terse, udevRule, waitOnline } from "../src/network";

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
    { name: "eth0", mac: "bc:24:11:b6:3a:39", up: true, addresses: ["192.168.1.233/24"], addresses6: ["2001:db8::5/64"], dynamic: true, gateway: "192.168.1.1", internet: "main" },
    { name: "enp2s0", mac: "aa:bb:cc:dd:ee:ff", up: false, addresses: [], addresses6: [], dynamic: false, gateway: "", internet: "none" },
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

test("parseWifi: one line per network — the one in use, otherwise the strongest — nameless ones left out", () => {
  const out = [" :Home:40:WPA2:2437 MHz", "*:Home:55:WPA2:5180 MHz", " :Home:90:WPA2:5200 MHz", " ::80:WPA2:2412 MHz", " :Cafe\\: free:30::2462 MHz", " :New:70:WPA3:5955 MHz", " :Mixed:20:WPA2 WPA3:2412 MHz", " :Old:10:--:2412 MHz", ""].join("\n");
  expect(parseWifi(out, ["Home", "Mixed"])).toEqual([
    { ssid: "Home", signal: 55, secure: true, wpa3: false, band: "5", active: true, known: true },
    { ssid: "New", signal: 70, secure: true, wpa3: true, band: "6", active: false, known: false },
    { ssid: "Cafe: free", signal: 30, secure: false, wpa3: false, band: "2.4", active: false, known: false },
    { ssid: "Mixed", signal: 20, secure: true, wpa3: false, band: "2.4", active: false, known: true },
    { ssid: "Old", signal: 10, secure: false, wpa3: false, band: "2.4", active: false, known: false },
  ]);
});

test("wifiProfile: the password goes into a file, the name as bytes", () => {
  const text = wifiProfile("hata-wifi-x", "wlp2s0", { ssid: "Дім;[x]", secure: true, wpa3: false }, "pa\\ss word=1");
  expect(text).toContain("id=hata-wifi-x\n");
  expect(text).toContain("interface-name=wlp2s0\n");
  expect(text).toContain(`ssid=${[...new TextEncoder().encode("Дім;[x]")].join(";")};\n`);
  expect(text).toContain("[wifi-security]\nkey-mgmt=wpa-psk\npsk=pa\\\\ss word=1\n");
  expect(wifiProfile("a", "wlan0", { ssid: "Open", secure: false, wpa3: false }, "")).not.toContain("wifi-security");
  expect(wifiProfile("a", "wlan0", { ssid: "New", secure: true, wpa3: true }, "12345678")).toContain("key-mgmt=sae\n");
});

test("wifiPassword and wifiProfileId", () => {
  expect(wifiPassword("12345678")).toBe(true);
  expect(wifiPassword("1234567")).toBe(false);
  expect(wifiPassword("x".repeat(64))).toBe(false);
  expect(wifiPassword("пароль-пароль")).toBe(false);
  expect(wifiPassword("line\nbreak12")).toBe(false);
  expect(wifiProfileId("Home Wi-Fi 5G")).toMatch(/^hata-wifi-Home-Wi-Fi-5G-[0-9a-f]{6}$/);
  expect(wifiProfileId("../../etc")).toMatch(/^hata-wifi-\.\.-\.\.-etc-[0-9a-f]{6}$/);
  expect(wifiProfileId("Дім")).toMatch(/^hata-wifi-network-[0-9a-f]{6}$/);
  expect(wifiProfileId("Дім")).not.toBe(wifiProfileId("Дача"));
});

test("the way to the internet: the lowest metric is the main one, the rest are spare", () => {
  const addr = JSON.stringify([
    { ifname: "enp3s0", link_type: "ether", flags: ["UP", "LOWER_UP"], addr_info: [{ family: "inet", local: "192.168.1.128", prefixlen: 24 }] },
    { ifname: "enx22b3cb594442", link_type: "ether", flags: ["UP", "LOWER_UP"], addr_info: [{ family: "inet", local: "192.168.0.100", prefixlen: 24 }] },
    { ifname: "wlp2s0", link_type: "ether", flags: ["UP"], addr_info: [] },
  ]);
  const route = JSON.stringify([
    { dst: "default", gateway: "192.168.0.1", dev: "enx22b3cb594442", metric: 101 },
    { dst: "default", gateway: "192.168.1.1", dev: "enp3s0", metric: 100 },
  ]);
  expect(parseLinks(addr, route).map((l) => [l.name, l.gateway, l.internet])).toEqual([["enp3s0", "192.168.1.1", "main"], ["enx22b3cb594442", "192.168.0.1", "backup"], ["wlp2s0", "", "none"]]);
  expect(roleArgs("main")).toEqual(["ipv4.route-metric", "50", "ipv6.route-metric", "50", "ipv4.never-default", "no", "ipv6.never-default", "no"]);
  expect(roleArgs("off").slice(4)).toEqual(["ipv4.never-default", "yes", "ipv6.never-default", "yes"]);
  expect(isModem("usb", "cdc_ether")).toBe(true);
  expect(isModem("usb", "r8152")).toBe(false);
  expect(isModem("pci", "cdc_ether")).toBe(false);
});

test("hotspotProfile: an access point that shares the server's way out and comes back after a restart", () => {
  const text = hotspotProfile("hata-hotspot-wlp2s0", "wlp2s0", { ssid: "Hata", password: "horse battery", band: "2.4" });
  expect(text).toContain("[wifi]\nmode=ap\nssid=72;97;116;97;\nband=bg\n");
  expect(text).toContain("key-mgmt=wpa-psk\nproto=rsn;\npairwise=ccmp;\npsk=horse battery\n");
  expect(text).toContain("[ipv4]\nmethod=shared\n");
  expect(text).toContain("autoconnect=true\nautoconnect-priority=10\n");
  expect(hotspotProfile("a", "wlan0", { ssid: "x", password: "12345678", band: "5" })).toContain("band=a\n");
});

test("parseLeases: who has joined the access point", () => {
  expect(parseLeases("1791890000 AA:bb:cc:dd:ee:01 10.42.0.15 pixel-8 01:aa:bb:cc:dd:ee:01\n1791890001 aa:bb:cc:dd:ee:02 10.42.0.77 * *\nduid 00:01\n\n")).toEqual([
    { mac: "aa:bb:cc:dd:ee:01", ip: "10.42.0.15", name: "pixel-8" },
    { mac: "aa:bb:cc:dd:ee:02", ip: "10.42.0.77", name: "" },
  ]);
});

test("wifiQrText: what a phone's camera reads, with the signs of the format escaped", () => {
  expect(wifiQrText("Hata", "horse battery")).toBe("WIFI:T:WPA;S:Hata;P:horse battery;;");
  expect(wifiQrText("my;net", 'p:a"s\\s,1')).toBe('WIFI:T:WPA;S:my\\;net;P:p\\:a\\"s\\\\s\\,1;;');
});

test("giving the internet out on an interface: the server is the router there", () => {
  expect(cleanChange({ method: "shared", address: "1.2.3.4/24", dns: "1.1.1.1" })).toEqual({ method: "shared", address: "", gateway: "", dns: [] });
  expect(profileArgs({ method: "shared", address: "", gateway: "", dns: [] }).slice(0, 2)).toEqual(["ipv4.method", "shared"]);
});

test("the check of the internet: NetworkManager's setting, and what it says of each interface", () => {
  expect(checkConf()).toContain("[connectivity]\nuri=http://nmcheck.gnome.org/check_network_status.txt\nresponse=NetworkManager is online\ninterval=60\n");
  const out = ["GENERAL.DEVICE:enp3s0", "GENERAL.IP4-CONNECTIVITY:3 (limited)", "", "GENERAL.DEVICE:enx344b50000000", "GENERAL.IP4-CONNECTIVITY:4 (full)", "", "GENERAL.DEVICE:wlp2s0", "GENERAL.IP4-CONNECTIVITY:0 (unknown)", "", "GENERAL.DEVICE:lo", "GENERAL.IP4-CONNECTIVITY:1 (none)", ""].join("\n");
  expect([...parseConnectivity(out)]).toEqual([["enp3s0", false], ["enx344b50000000", true], ["lo", false]]);
});
