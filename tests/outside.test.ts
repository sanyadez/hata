import { expect, test } from "bun:test";
import { cleanOutside, inNetworkOf, isPublic, outsideDown, outsideRules } from "../src/outside";

test("public addresses are the ones the internet reaches", () => {
  for (const ip of ["10.0.0.5/8", "192.168.1.128/24", "172.16.0.1", "172.31.255.1", "100.64.0.1", "100.127.1.1", "169.254.3.3", "127.0.0.1"]) expect(isPublic(ip)).toBe(false);
  for (const ip of ["8.8.8.8", "93.175.1.2/22", "172.32.0.1", "100.128.0.1", "192.169.0.1"]) expect(isPublic(ip)).toBe(true);
  expect(isPublic("nonsense")).toBe(false);
});

test("an address is found in the network of an interface, both families", () => {
  expect(inNetworkOf("192.168.1.220", ["192.168.1.128/24"])).toBe(true);
  expect(inNetworkOf("192.168.2.1", ["192.168.1.128/24"])).toBe(false);
  expect(inNetworkOf("10.1.2.3", ["10.0.0.1/8"])).toBe(true);
  expect(inNetworkOf("2001:db8:1:2::77", ["2001:db8:1:2::5/64"])).toBe(true);
  expect(inNetworkOf("2001:db8:1:3::77", ["2001:db8:1:2::5/64"])).toBe(false);
  expect(inNetworkOf("192.168.1.5", ["2001:db8::1/64"])).toBe(false);
  expect(inNetworkOf("", ["192.168.1.1/24"])).toBe(false);
});

test("the chain lets in only answers, IPv6's own messages and the tunnels' ports", () => {
  const v4 = outsideRules(["enp1s0"], { wireguard: 51820 }, "4").map((r) => r.join(" "));
  expect(v4[0]).toBe("-A HATA-OUTSIDE -i enp1s0 -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN");
  expect(v4).toContain("-A HATA-OUTSIDE -i enp1s0 -p udp --dport 51820 -j RETURN");
  expect(v4.at(-1)).toBe("-A HATA-OUTSIDE -i enp1s0 -j DROP");
  expect(v4.some((r) => r.includes("ipv6-icmp"))).toBe(false);
  const v6 = outsideRules(["enp1s0", "wan0"], { wireguard: null }, "6").map((r) => r.join(" "));
  expect(v6).toContain("-A HATA-OUTSIDE -i wan0 -p ipv6-icmp -j RETURN");
  expect(v6.some((r) => r.includes("51820"))).toBe(false);
  expect(v6.filter((r) => r.endsWith("-j DROP"))).toEqual(["-A HATA-OUTSIDE -i enp1s0 -j DROP", "-A HATA-OUTSIDE -i wan0 -j DROP"]);
});

test("the names kept are interface names only", () => {
  expect(cleanOutside(["enp3s0", "enp3s0", "bad name", 5, "x".repeat(16)])).toEqual(["enp3s0"]);
  expect(cleanOutside(null)).toEqual([]);
});

test("taking the rules away never fails", () => {
  const lines = outsideDown();
  expect(lines.every((line) => line.endsWith("done") || line.endsWith("true"))).toBe(true);
  expect(lines.some((line) => line.includes("ip6tables -D DOCKER-USER"))).toBe(true);
});
