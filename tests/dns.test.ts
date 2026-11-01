import { expect, test } from "bun:test";
import { aged, cleanDns, cleanRecord, cleanServer, FALLBACK, ipv4, ipv6, keepFor, nameservers, ownAnswer, queryFor, RCODE, readAsk, reply, truncated, TYPE, underDomain, upstreamsOf, withId } from "../src/dns";

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number) => [...u16(n >>> 16), ...u16(n & 0xffff)];

test("queryFor and readAsk: one question read back", () => {
  const q = queryFor("Web.Hata.LAN", TYPE.A, 0x1234);
  expect(readAsk(q)).toEqual({ id: 0x1234, name: "web.hata.lan", type: TYPE.A, cls: 1, rd: true, end: q.length });
  // an answer is not a question; two questions are not answered
  const answer = new Uint8Array(q);
  answer[2] = 0x81;
  expect(readAsk(answer)).toBeNull();
  const two = new Uint8Array(q);
  two[5] = 2;
  expect(readAsk(two)).toBeNull();
  expect(readAsk(new Uint8Array(5))).toBeNull();
});

test("reply: the question as asked, records pointing at its name", () => {
  const q = queryFor("web.hata.lan", TYPE.A, 7);
  const ask = readAsk(q)!;
  const r = reply(q, ask, RCODE.OK, [{ type: TYPE.A, ttl: 60, data: [192, 168, 1, 128] }]);
  expect(r[0]).toBe(0);
  expect(r[1]).toBe(7);
  expect(r[2]! & 0x80).toBe(0x80); // an answer
  expect(r[2]! & 0x04).toBe(0x04); // authoritative
  expect(r[3]! & 0x80).toBe(0x80); // recursion available
  expect(r[7]).toBe(1);
  expect([...r.slice(-16)]).toEqual([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 192, 168, 1, 128]);
  expect(keepFor(r)).toBe(60);
  expect(reply(q, ask, RCODE.REFUSED)[3]! & 0xf).toBe(RCODE.REFUSED);
});

/** An upstream answer with records of the given TTLs, an EDNS record at the end */
function upstream(ttls: number[], rcode = 0): Uint8Array {
  const q = queryFor("debian.org", TYPE.A, 9);
  const records = ttls.flatMap((ttl, i) => [0xc0, 0x0c, 0, 1, 0, 1, ...u32(ttl), 0, 4, 151, 101, 2, 132 + i]);
  const opt = [0, 0, 41, 0x10, 0, 0, 0, 0x80, 0, 0, 0]; // DO bit in the TTL field: not a TTL
  const out = new Uint8Array([...q.slice(0, 2), 0x81, 0x80 | rcode, 0, 1, 0, ttls.length, 0, 0, 0, 1, ...q.slice(12), ...records, ...opt]);
  return out;
}

test("keepFor: the smallest TTL, bounded; failures are not kept; EDNS is not a TTL", () => {
  expect(keepFor(upstream([300, 120]))).toBe(120);
  expect(keepFor(upstream([1]))).toBe(5);
  expect(keepFor(upstream([86400]))).toBe(3600);
  expect(keepFor(upstream([], RCODE.NXDOMAIN))).toBe(60);
  expect(keepFor(upstream([300], RCODE.SERVFAIL))).toBeNull();
  expect(keepFor(new Uint8Array([1, 2, 3]))).toBeNull();
});

test("aged: kept answers count their TTLs down; withId gives the asker's id", () => {
  const got = aged(upstream([300, 120]), 100);
  expect(keepFor(got)).toBe(20);
  expect(keepFor(aged(upstream([30]), 100))).toBe(5);
  const again = withId(got, 0xabcd);
  expect([again[0], again[1]]).toEqual([0xab, 0xcd]);
  expect(truncated(again)).toBe(false);
});

test("ownAnswer: our domains with one label under them, the person's records; the rest goes on", () => {
  const ctx = { domains: ["hata.lan", "home.example.com"], records: [cleanRecord({ name: "printer.lan", value: "192.168.1.40" })!, cleanRecord({ name: "nas.lan", type: "AAAA", value: "fd00::4" })!], hata: "192.168.1.128" };
  const ask = (name: string, type: number) => readAsk(queryFor(name, type, 1))!;
  expect(ownAnswer(ask("web.hata.lan", TYPE.A), ctx)).toEqual({ rcode: 0, answers: [{ type: TYPE.A, ttl: 60, data: [192, 168, 1, 128] }] });
  expect(ownAnswer(ask("home.example.com", TYPE.A), ctx)?.answers.length).toBe(1);
  expect(ownAnswer(ask("git.home.example.com", TYPE.AAAA), ctx)).toEqual({ rcode: 0, answers: [] });
  expect(ownAnswer(ask("a.b.hata.lan", TYPE.A), ctx)).toBeNull();
  expect(ownAnswer(ask("printer.lan", TYPE.A), ctx)?.answers[0]?.data).toEqual([192, 168, 1, 40]);
  expect(ownAnswer(ask("printer.lan", TYPE.AAAA), ctx)).toEqual({ rcode: 0, answers: [] });
  expect(ownAnswer(ask("nas.lan", TYPE.AAAA), ctx)?.answers[0]?.data.length).toBe(16);
  expect(ownAnswer(ask("debian.org", TYPE.A), ctx)).toBeNull();
  expect(underDomain("hata.lan", "hata.lan")).toBe(true);
  expect(underDomain("xhata.lan", "hata.lan")).toBe(false);
  expect(underDomain("x.hata.lan", "")).toBe(false);
});

test("addresses, records, servers", () => {
  expect(ipv4("10.0.0.1")).toEqual([10, 0, 0, 1]);
  expect(ipv4("10.0.0.256")).toBeNull();
  expect(ipv6("fd00::4")?.slice(0, 2)).toEqual([0xfd, 0]);
  expect(ipv6("fd00::4")?.at(-1)).toBe(4);
  expect(ipv6("nope")).toBeNull();
  expect(cleanRecord({ name: "Printer.LAN.", value: "192.168.1.40" })).toEqual({ name: "printer.lan", type: "A", value: "192.168.1.40" });
  expect(cleanRecord({ name: "bad name", value: "192.168.1.40" })).toBeNull();
  expect(cleanRecord({ name: "x.lan", type: "AAAA", value: "192.168.1.40" })).toBeNull();
  expect(cleanServer("1.1.1.1")).toBe("1.1.1.1");
  expect(cleanServer("https://dns.example/dns-query")).toBe("https://dns.example/dns-query");
  expect(cleanServer("http://dns.example/dns-query")).toBeNull();
  expect(cleanServer("x")).toBeNull();
  expect(cleanDns({ enabled: true, upstream: "nope", servers: ["1.1.1.1", "bad"] })).toEqual({ enabled: true, upstream: "system", doh: false, servers: ["1.1.1.1"], records: [] });
  expect(nameservers("# x\nnameserver 192.168.1.1\nnameserver fe80::1%eth0\nsearch lan\n")).toEqual(["192.168.1.1", "fe80::1"]);
});

test("upstreamsOf: never Hata itself, never a server that sends questions back; presets by address", () => {
  const own = ["192.168.1.128", "127.0.0.1"];
  expect(upstreamsOf({ upstream: "system", doh: false, servers: [] }, ["192.168.1.1"], own)).toEqual([{ kind: "udp", host: "192.168.1.1" }]);
  // the router hands out Hata: the system knows no other server
  expect(upstreamsOf({ upstream: "system", doh: false, servers: [] }, ["192.168.1.128"], own)).toEqual(FALLBACK);
  expect(upstreamsOf({ upstream: "system", doh: false, servers: [] }, ["192.168.1.1"], own, ["192.168.1.1"])).toEqual(FALLBACK);
  expect(upstreamsOf({ upstream: "quad9", doh: true, servers: [] }, [], own)[0]).toEqual({ kind: "dot", host: "9.9.9.9", name: "dns.quad9.net" });
  expect(upstreamsOf({ upstream: "cloudflare", doh: false, servers: [] }, [], own)[0]).toEqual({ kind: "udp", host: "1.1.1.1" });
  expect(upstreamsOf({ upstream: "custom", doh: false, servers: ["192.168.1.128", "9.9.9.9", "https://x/dns-query"] }, [], own)).toEqual([{ kind: "udp", host: "9.9.9.9" }, { kind: "doh", url: "https://x/dns-query" }]);
});
