import { expect, test } from "bun:test";
import { parseCompose } from "../src/appform";
import { settings } from "../src/config";
import { gateTarget, guardsOf, mayOpen, otherPorts, overrideText } from "../src/gate";

const compose = parseCompose(`
name: demo
services:
  db:
    image: postgres
  web:
    image: demo
    ports:
      - "8080:80"
      - target: 443
        published: "8443"
        protocol: tcp
      - "9000-9010:9000-9010"
x-casaos:
  port_map: "8443"
`);

test("the web port is found; apps without one cannot be guarded", () => {
  expect(gateTarget(compose, "/DATA")).toEqual({ service: "web", target: 443, port: 8443 });
  // no store metadata: the first published TCP port
  expect(gateTarget(parseCompose("services:\n  a:\n    image: x\n    ports:\n      - 53:53/udp\n      - 3000:3000"), "/DATA")).toEqual({ service: "a", target: 3000, port: 3000 });
  expect(gateTarget(parseCompose("services:\n  a:\n    image: x"), "/DATA")).toBe("noPort");
  expect(gateTarget(parseCompose("services:\n  a:\n    image: x\n    network_mode: host\nx-casaos:\n  port_map: '8123'"), "/DATA")).toBe("hostNetwork");
});

test("the override moves only the web port to localhost and keeps the others", () => {
  const text = overrideText(compose, "/DATA", [{ port: 8443, upstream: 28443 }]);
  const parsed = parseCompose(text.replace("!override", ""));
  expect(Object.keys(parsed.services)).toEqual(["web"]);
  expect(parsed.services.web.ports).toEqual([
    { target: 80, published: "8080", protocol: "tcp" },
    { target: 443, published: "28443", protocol: "tcp", host_ip: "127.0.0.1" },
    "9000-9010:9000-9010",
  ]);
  expect(text).toContain("ports: !override");
  expect(text.startsWith("# Written by Hata")).toBe(true);
});

const several = parseCompose(`
services:
  web:
    image: demo
    ports:
      - "\${WEB_PORT:-8080}:80"
      - "127.0.0.1:9229:9229"
      - "2222:22"
      - "5353:53/udp"
  api:
    image: demo
    ports:
      - "9000:9000"
  db:
    image: postgres
`);

test("the other ports of an app: published to the network over TCP, besides the web one", () => {
  expect(gateTarget(several, "/DATA", { WEB_PORT: "8181" })).toEqual({ service: "web", target: 80, port: 8181 });
  expect(gateTarget(several, "/DATA")).toEqual({ service: "web", target: 80, port: 8080 });
  expect(otherPorts(several, "/DATA").map((p) => p.port)).toEqual([2222, 9000]);
  expect(otherPorts(parseCompose("services:\n  a:\n    image: x"), "/DATA")).toEqual([]);
});

test("several guarded ports: every service that has one gets its list again", () => {
  const text = overrideText(several, "/DATA", [{ port: 8181, upstream: 28181 }, { port: 9000, upstream: 29000 }], { WEB_PORT: "8181" });
  const parsed = parseCompose(text.replaceAll("!override", ""));
  expect(Object.keys(parsed.services)).toEqual(["web", "api"]);
  expect(parsed.services.web.ports).toEqual([
    { target: 80, published: "28181", protocol: "tcp", host_ip: "127.0.0.1" },
    // already local: left alone
    { target: 9229, published: "9229", protocol: "tcp", host_ip: "127.0.0.1" },
    { target: 22, published: "2222", protocol: "tcp" },
    { target: 53, published: "5353", protocol: "udp" },
  ]);
  expect(parsed.services.api.ports).toEqual([{ target: 9000, published: "29000", protocol: "tcp", host_ip: "127.0.0.1" }]);
});

test("the guarded ports as the settings hold them", () => {
  expect(guardsOf({ allowed: "all", protect: false })).toEqual([]);
  expect(guardsOf({ allowed: "all", protect: true, port: 80, upstream: 20080, extra: [{ port: 9000, upstream: 29000 }] })).toEqual([{ port: 80, upstream: 20080 }, { port: 9000, upstream: 29000 }]);
});

test("who may open an app", () => {
  const admin = { id: "a", role: "admin" as const };
  const member = { id: "m", role: "member" as const };
  const guest = { id: "g", role: "guest" as const };
  // no rule: every member, no guest
  expect([admin, member, guest].map((u) => mayOpen(u, "free"))).toEqual([true, true, false]);
  settings.access.photos = { allowed: ["g"], protect: true };
  expect([admin, member, guest].map((u) => mayOpen(u, "photos"))).toEqual([true, false, true]);
  settings.access.photos = { allowed: [], protect: false };
  expect([admin, member, guest].map((u) => mayOpen(u, "photos"))).toEqual([true, false, false]);
  delete settings.access.photos;
});

test("the override of an app of another machine names the Hata it opens through", () => {
  const text = overrideText(compose, "/DATA", [{ port: 8443, upstream: 28443 }], {}, { host: "hata-pc", port: 8444 });
  expect(text.split("\n")[0]).toContain("Hata at hata-pc, opened there on port 8444");
  const moved = text.split("\n").find((line) => line.includes('"published":"28443"'));
  expect(moved).toContain('"host_ip":"127.0.0.1"');
});

test("devices this server has not are left out of the app, the rest kept", async () => {
  const { presentDevices, overrideText } = await import("../src/gate");
  const compose = { services: { plex: { image: "plex", devices: ["/dev/dri:/dev/dri", "/dev/dvb:/dev/dvb", "nvidia.com/gpu=all"] }, web: { image: "nginx", devices: ["/dev/dri:/dev/dri"] } } };
  const found = presentDevices(compose, (p) => p === "/dev/dri");
  expect(found).toEqual({ devices: { plex: ["/dev/dri:/dev/dri", "nvidia.com/gpu=all"] }, missing: ["/dev/dvb"] });
  const text = overrideText(compose, "/DATA", [], {}, undefined, found);
  expect(text).toContain("left out: /dev/dvb");
  expect(text).toContain('  "plex":\n    devices: !override ["/dev/dri:/dev/dri","nvidia.com/gpu=all"]');
  expect(text).not.toContain('"web"');
  expect(Bun.YAML.parse(text.replace(/!override /g, ""))).toEqual({ services: { plex: { devices: ["/dev/dri:/dev/dri", "nvidia.com/gpu=all"] } } });
});
