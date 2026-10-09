import { expect, test } from "bun:test";
import { parseCompose } from "../src/appform";
import { settings } from "../src/config";
import { gateTarget, mayOpen, overrideText } from "../src/gate";

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
  const text = overrideText(compose, "/DATA", { service: "web", target: 443, port: 8443 }, 28443);
  const parsed = parseCompose(text.replace("!override", ""));
  expect(Object.keys(parsed.services)).toEqual(["web"]);
  expect(parsed.services.web.ports).toEqual([
    { target: 80, published: "8080", protocol: "tcp" },
    { target: 443, published: "28443", protocol: "tcp", host_ip: "127.0.0.1" },
    "9000-9010:9000-9010",
  ]);
  expect(text).toContain("ports: !override");
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
