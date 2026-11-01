import { expect, test } from "bun:test";
import { clash, cleanForwards, deviceName, isOurDevice, outsideOpenings, ownPorts, protocolsOf, proxyDevice, readForward } from "../src/forward";
import { NameError } from "../src/names";
import { outsideRules } from "../src/outside";

const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return e instanceof NameError ? e.code : String(e);
  }
  return "";
};
const target = { kind: "container", name: "web" };

test("readForward: a port of this server, a protocol, a target and its port", () => {
  expect(readForward({ port: 2222, target, to: 22, note: " SSH\n" }, [])).toEqual({ port: 2222, proto: "tcp", target, to: 22, outside: false, note: "SSH" });
  expect(readForward({ port: 27015, proto: "both", target: { kind: "address", host: "192.168.1.50" }, to: 27015, outside: true }, []).outside).toBe(true);
  expect(code(() => readForward({ port: 0, target, to: 22 }, []))).toBe("ports.badPort");
  expect(code(() => readForward({ port: 2222, target, to: 70000 }, []))).toBe("ports.badPort");
  expect(code(() => readForward({ port: 2222, target: { kind: "x" }, to: 22 }, []))).toBe("domains.badTarget");
  // the same port of the other protocol is free; of the same one, or of both, it is not
  expect(code(() => readForward({ port: 2222, proto: "udp", target, to: 22 }, [{ port: 2222, proto: "tcp" }]))).toBe("");
  expect(code(() => readForward({ port: 2222, proto: "both", target, to: 22 }, [{ port: 2222, proto: "tcp" }]))).toBe("ports.taken");
  expect(code(() => readForward({ port: 8080, target, to: 80 }, ownPorts(8080, 443)))).toBe("ports.taken");
  expect(code(() => readForward({ port: 53, proto: "udp", target, to: 53 }, ownPorts(80, 443)))).toBe("ports.taken");
});

test("clash, protocolsOf, cleanForwards", () => {
  expect(protocolsOf("both")).toEqual(["tcp", "udp"]);
  expect(clash({ port: 1, proto: "tcp" }, { port: 1, proto: "udp" })).toBe(false);
  expect(clash({ port: 1, proto: "both" }, { port: 1, proto: "udp" })).toBe(true);
  const one = { port: 2222, proto: "tcp", target, to: 22, outside: false, note: "" };
  expect(cleanForwards([one, { ...one }, { port: "x" }, null]).length).toBe(1);
  expect(cleanForwards({})).toEqual([]);
});

test("the proxy device of Incus listens on the server and connects inside the container", () => {
  expect(deviceName(2222, "tcp")).toBe("hata-port-tcp-2222");
  expect(proxyDevice({ port: 2222, to: 22 }, "tcp")).toEqual({ type: "proxy", listen: "tcp:0.0.0.0:2222", connect: "tcp:127.0.0.1:22", bind: "host" });
  expect(isOurDevice("hata-port-udp-27015")).toBe(true);
  expect(isOurDevice("eth0")).toBe(false);
});

test("a port opened on the internet side gets through the chain there", () => {
  const forwards = readForward({ port: 25565, proto: "both", target, to: 25565, outside: true }, []);
  const open = outsideOpenings([forwards, readForward({ port: 2222, target, to: 22 }, [])]);
  expect(open).toEqual([{ port: 25565, proto: "tcp" }, { port: 25565, proto: "udp" }]);
  const rules = outsideRules(["wan0"], { wireguard: null, ports: open }, "4").map((r) => r.join(" "));
  expect(rules).toContain("-A HATA-OUTSIDE -i wan0 -p tcp --dport 25565 -j RETURN");
  expect(rules).toContain("-A HATA-OUTSIDE -i wan0 -p udp --dport 25565 -j RETURN");
  expect(rules.at(-1)).toBe("-A HATA-OUTSIDE -i wan0 -j DROP");
  expect(rules.some((r) => r.includes("2222"))).toBe(false);
});
