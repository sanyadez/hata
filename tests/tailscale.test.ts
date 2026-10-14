import { expect, test } from "bun:test";
import { cleanServer, homeNetworks, networkOf, parsePrefs, parseStatus } from "../src/tailscale";

test("a server nobody signed in to", () => {
  expect(parseStatus(JSON.stringify({ BackendState: "NeedsLogin", AuthURL: "", Self: { DNSName: "", TailscaleIPs: null }, Health: ["not logged in"], Peer: null }))).toEqual({ state: "needsLogin", authUrl: "", name: "", addresses: [], tailnet: "", expires: 0, approved: [], carried: {}, health: ["not logged in"], devices: [] });
  // the link is out: waiting for the person
  expect(parseStatus(JSON.stringify({ BackendState: "NeedsLogin", AuthURL: "https://login.tailscale.com/a/1a2b3c" }))).toMatchObject({ state: "starting", authUrl: "https://login.tailscale.com/a/1a2b3c" });
  expect(parseStatus(JSON.stringify({ BackendState: "NeedsLogin", AuthURL: "javascript:alert(1)" }))).toMatchObject({ state: "needsLogin", authUrl: "" });
  expect(parseStatus("failed to connect to local tailscaled")).toBeNull();
});

test("a server in its private network, with the other devices", () => {
  const status = parseStatus(
    JSON.stringify({
      BackendState: "Running",
      AuthURL: "",
      Self: { HostName: "hata", DNSName: "hata.tail1234.ts.net.", TailscaleIPs: ["100.101.102.103", "fd7a:115c:a1e0::1"], KeyExpiry: "2027-04-11T10:00:00Z", AllowedIPs: ["100.101.102.103/32", "fd7a:115c:a1e0::1/128", "192.168.1.0/24"] },
      CurrentTailnet: { Name: "someone@example.com" },
      Health: [],
      Peer: {
        "nodekey:b": { HostName: "Pixel 9", DNSName: "pixel-9.tail1234.ts.net.", OS: "android", TailscaleIPs: ["100.1.1.2"], Online: false, LastSeen: "2026-10-12T08:00:00Z" },
        "nodekey:a": { HostName: "laptop", DNSName: "laptop.tail1234.ts.net.", OS: "macOS", TailscaleIPs: ["100.1.1.1"], Online: true, LastSeen: "0001-01-01T00:00:00Z" },
      },
    }),
  )!;
  expect(status).toMatchObject({ state: "running", name: "hata.tail1234.ts.net", addresses: ["100.101.102.103", "fd7a:115c:a1e0::1"], tailnet: "someone@example.com", expires: Date.parse("2027-04-11T10:00:00Z"), approved: ["192.168.1.0/24"] });
  expect(status.devices).toEqual([
    { name: "laptop", os: "macOS", addresses: ["100.1.1.1"], online: true, lastSeen: 0 },
    { name: "pixel-9", os: "android", addresses: ["100.1.1.2"], online: false, lastSeen: Date.parse("2026-10-12T08:00:00Z") },
  ]);
  expect(parseStatus(JSON.stringify({ BackendState: "Stopped", Self: { DNSName: "hata.tail1234.ts.net.", KeyExpiry: "0001-01-01T00:00:00Z" } }))).toMatchObject({ state: "off", name: "hata.tail1234.ts.net", expires: 0 });
});

test("the service signed in to and the networks offered", () => {
  expect(parsePrefs(JSON.stringify({ ControlURL: "https://controlplane.tailscale.com", AdvertiseRoutes: null }))).toEqual({ server: "", offered: [] });
  expect(parsePrefs(JSON.stringify({ ControlURL: "http://192.168.1.5:8080", AdvertiseRoutes: ["192.168.1.0/24"] }))).toEqual({ server: "http://192.168.1.5:8080", offered: ["192.168.1.0/24"] });
  expect(parsePrefs("no daemon")).toEqual({ server: "", offered: [] });
});

test("the home networks to offer", () => {
  expect(networkOf({ address: "192.168.1.128", netmask: "255.255.255.0" })).toBe("192.168.1.0/24");
  expect(networkOf({ address: "10.20.37.5", netmask: "255.255.252.0" })).toBe("10.20.36.0/22");
  const links = [{ address: "192.168.1.128", netmask: "255.255.255.0" }, { address: "192.168.1.129", netmask: "255.255.255.0" }, { address: "100.101.102.103", netmask: "255.255.255.255" }, { address: "100.64.0.9", netmask: "255.192.0.0" }, { address: "10.0.0.2", netmask: "255.255.255.255" }];
  expect(homeNetworks(links)).toEqual(["192.168.1.0/24"]);
});

test("a service of one's own is a web address and nothing more", () => {
  expect(cleanServer("")).toBe("");
  expect(cleanServer(undefined)).toBe("");
  expect(cleanServer(" https://headscale.example.com/ ")).toBe("https://headscale.example.com");
  expect(cleanServer("http://192.168.1.5:8080")).toBe("http://192.168.1.5:8080");
  for (const bad of ["headscale.example.com", "https://a b", "--login-server=x", "https://x/?a=1", 5]) expect(cleanServer(bad)).toBeNull();
});

test("as the real program prints it: a router of the private network already carries the home network", () => {
  // the shape of tailscale 1.104 `status --json`, trimmed
  const status = parseStatus(
    JSON.stringify({
      BackendState: "Running",
      AuthURL: "",
      TailscaleIPs: ["100.126.189.118", "fd7a:115c:a1e0::6a28:bd77"],
      Self: { HostName: "test", DNSName: "test.tail1df48.ts.net.", OS: "linux", TailscaleIPs: ["100.126.189.118", "fd7a:115c:a1e0::6a28:bd77"], AllowedIPs: ["100.126.189.118/32", "fd7a:115c:a1e0::6a28:bd77/128", "192.168.2.0/24"], PrimaryRoutes: ["192.168.2.0/24"], KeyExpiry: "2027-04-12T04:40:12Z", Online: true },
      Health: ["Some peers are advertising routes but --accept-routes is false"],
      CurrentTailnet: { Name: "someone@example.com", MagicDNSSuffix: "tail1df48.ts.net", MagicDNSEnabled: true },
      Peer: {
        "nodekey:1": { HostName: "GL-MT6000", DNSName: "gl-mt6000.tail1df48.ts.net.", OS: "linux", TailscaleIPs: ["100.75.74.126"], PrimaryRoutes: ["192.168.0.0/24", "192.168.1.0/24"], Online: true, LastSeen: "0001-01-01T00:00:00Z" },
        "nodekey:2": { HostName: "localhost", DNSName: "samsung-sm-s918b.tail1df48.ts.net.", OS: "android", TailscaleIPs: ["100.117.169.89"], Online: false, LastSeen: "2025-11-19T07:02:11.1Z" },
      },
    }),
  )!;
  expect(status).toMatchObject({ state: "running", name: "test.tail1df48.ts.net", tailnet: "someone@example.com", approved: ["192.168.2.0/24"], carried: { "192.168.0.0/24": "gl-mt6000", "192.168.1.0/24": "gl-mt6000" }, health: [] });
  expect(status.expires).toBe(Date.parse("2027-04-12T04:40:12Z"));
  expect(status.devices.map((d) => [d.name, d.online])).toEqual([["gl-mt6000", true], ["samsung-sm-s918b", false]]);
});
