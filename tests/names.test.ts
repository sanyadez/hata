import { expect, test } from "bun:test";
import { cleanHost, cleanNames, cleanTarget, NameError, readName, renamedTarget, upstreamOf, urlHost, type DomainName, type World } from "../src/names";

const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return e instanceof NameError ? e.code : String(e);
  }
  return "";
};

test("cleanHost: a name or an address, nothing more", () => {
  expect(cleanHost(" NAS.lan ")).toBe("nas.lan");
  expect(cleanHost("192.168.1.10")).toBe("192.168.1.10");
  expect(cleanHost("[fd00::5]")).toBe("fd00::5");
  expect(cleanHost("192.168.1.300")).toBeNull();
  expect(cleanHost("nas.lan:8080")).toBeNull();
  expect(cleanHost("http://nas")).toBeNull();
  expect(cleanHost("a b")).toBeNull();
  expect(cleanHost("")).toBeNull();
});

test("cleanTarget: each kind with what it needs", () => {
  expect(cleanTarget({ kind: "container", name: "web" })).toEqual({ kind: "container", name: "web" });
  expect(cleanTarget({ kind: "container", name: "Web!" })).toBeNull();
  expect(cleanTarget({ kind: "guest", host: "a1b2c3d4", guest: "lxc/243" })).toEqual({ kind: "guest", host: "a1b2c3d4", guest: "lxc/243" });
  expect(cleanTarget({ kind: "guest", host: "a1b2c3d4", guest: "lxc/abc" })).toBeNull();
  expect(cleanTarget({ kind: "machine", id: "a1b2c3d4" })).toEqual({ kind: "machine", id: "a1b2c3d4" });
  expect(cleanTarget({ kind: "machineApp", id: "a1b2c3d4", app: "uptime-kuma" })).toEqual({ kind: "machineApp", id: "a1b2c3d4", app: "uptime-kuma" });
  expect(cleanTarget({ kind: "address", host: "192.168.1.1" })).toEqual({ kind: "address", host: "192.168.1.1" });
  expect(cleanTarget({ kind: "address", host: "x y" })).toBeNull();
  expect(cleanTarget({ kind: "other" })).toBeNull();
  expect(cleanTarget(null)).toBeNull();
});

test("readName: a label free under the domain, a target, a port", () => {
  const n = readName({ label: "Router", target: { kind: "address", host: "192.168.1.1" }, port: 80, protect: true, allowed: ["u1", "nobody"] }, ["web"], ["u1"]);
  expect(n).toEqual({ label: "router", target: { kind: "address", host: "192.168.1.1" }, port: 80, https: false, protect: true, allowed: ["u1"] });
  expect(readName({ label: "nas", target: { kind: "address", host: "nas" }, port: 5001, https: true }, [], []).allowed).toBe("all");
  expect(code(() => readName({ label: "web", target: { kind: "address", host: "x" }, port: 80 }, ["web"], []))).toBe("domains.taken");
  expect(code(() => readName({ label: "-a", target: { kind: "address", host: "x" }, port: 80 }, [], []))).toBe("domains.badLabel");
  expect(code(() => readName({ label: "a.b", target: { kind: "address", host: "x" }, port: 80 }, [], []))).toBe("domains.badLabel");
  expect(code(() => readName({ label: "a", target: { kind: "address", host: "x" }, port: 0 }, [], []))).toBe("domains.badPort");
  expect(code(() => readName({ label: "a", target: { kind: "nope" }, port: 80 }, [], []))).toBe("domains.badTarget");
});

test("cleanNames: what is not a name is left out, a label twice is kept once", () => {
  const one = { label: "a", target: { kind: "address", host: "x" }, port: 80, https: false, protect: false, allowed: "all" };
  expect(cleanNames([one, { ...one }, { label: "bad label" }, 5]).map((n) => n.label)).toEqual(["a"]);
  expect(cleanNames("x")).toEqual([]);
});

const world: World = {
  container: (n) => (n === "web" ? "10.0.0.5" : n === "stopped" ? "" : null),
  guest: (h, g) => (h === "pve" && g === "lxc/243" ? "192.168.1.243" : null),
  machine: (id) => (id === "m1" ? "192.168.1.20" : id === "m2" ? "" : null),
  tunnel: (id, app) => (id === "m1" && app === "kuma" ? 40123 : 0),
};
const name = (target: DomainName["target"], port = 80, https = false): DomainName => ({ label: "x", target, port, https, protect: false, allowed: "all" });

test("upstreamOf: where a name leads now, or why it cannot", async () => {
  expect(await upstreamOf(name({ kind: "address", host: "nas" }, 5001, true), world)).toEqual({ host: "nas", port: 5001, https: true });
  expect(await upstreamOf(name({ kind: "container", name: "web" }), world)).toEqual({ host: "10.0.0.5", port: 80, https: false });
  expect(await upstreamOf(name({ kind: "container", name: "stopped" }), world)).toEqual({ away: "domains.away.noAddress" });
  expect(await upstreamOf(name({ kind: "container", name: "gone" }), world)).toEqual({ away: "domains.away.noContainer" });
  expect(await upstreamOf(name({ kind: "guest", host: "pve", guest: "lxc/243" }, 8006, true), world)).toEqual({ host: "192.168.1.243", port: 8006, https: true });
  expect(await upstreamOf(name({ kind: "guest", host: "pve", guest: "lxc/1" }), world)).toEqual({ away: "domains.away.noGuest" });
  expect(await upstreamOf(name({ kind: "machine", id: "m2" }), world)).toEqual({ away: "domains.away.machineAway" });
  expect(await upstreamOf(name({ kind: "machine", id: "m9" }), world)).toEqual({ away: "domains.away.noMachine" });
  // behind Hata's sign-in a machine's app is reached through its tunnel, whatever port the name says
  expect(await upstreamOf(name({ kind: "machineApp", id: "m1", app: "kuma" }, 3001), world)).toEqual({ host: "127.0.0.1", port: 40123, https: false });
  expect(await upstreamOf(name({ kind: "machineApp", id: "m1", app: "other" }, 3001), world)).toEqual({ host: "192.168.1.20", port: 3001, https: false });
});

test("renamedTarget: a name follows its instance", () => {
  const list = [name({ kind: "container", name: "web" }), { ...name({ kind: "container", name: "db" }), label: "y" }];
  expect(renamedTarget(list, { kind: "container", name: "web" }, { kind: "container", name: "site" }).map((n) => n.target)).toEqual([{ kind: "container", name: "site" }, { kind: "container", name: "db" }]);
  expect(urlHost("fd00::1")).toBe("[fd00::1]");
  expect(urlHost("nas")).toBe("nas");
});
