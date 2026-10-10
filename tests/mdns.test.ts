import { expect, test } from "bun:test";
import { addressFor, announcement, answerQuery, answersItself, isLocalName, parseQuery } from "../src/mdns";

/** A query as a resolver sends it: one question per name, optionally with the "answer me alone" bit */
function query(names: [string, number][], id = 0, unicast = false): Uint8Array {
  const out = [id >> 8, id & 255, 0, 0, 0, names.length, 0, 0, 0, 0, 0, 0];
  for (const [name, type] of names) {
    for (const label of name.split(".")) out.push(label.length, ...new TextEncoder().encode(label));
    out.push(0, type >> 8, type & 255, unicast ? 0x80 : 0, 1);
  }
  return new Uint8Array(out);
}

const ours = (name: string) => isLocalName(name, "hata.local");

test("a query is read: names in any case, compressed names, the unicast bit; answers are not queries", () => {
  expect(parseQuery(query([["Hata.Local", 1], ["memos.hata.local", 28]], 7, true))).toEqual({ id: 7, questions: [{ name: "hata.local", type: 1, unicast: true }, { name: "memos.hata.local", type: 28, unicast: true }] });
  // the second name is "memos" and then a pointer to the first one, at offset 12
  const packed = new Uint8Array([...query([["hata.local", 1]]), 5, ...new TextEncoder().encode("memos"), 0xc0, 12, 0, 1, 0, 1]);
  packed[5] = 2;
  expect(parseQuery(packed)?.questions.map((q) => q.name)).toEqual(["hata.local", "memos.hata.local"]);
  const answer = query([["hata.local", 1]]);
  answer[2] = 0x84;
  expect(parseQuery(answer)).toBeNull();
  // cut short, or a pointer that leads to itself
  expect(parseQuery(query([["hata.local", 1]]).subarray(0, 20))).toBeNull();
  expect(parseQuery(new Uint8Array([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0xc0, 12, 0, 1, 0, 1]))).toBeNull();
});

test("only the name itself and one label under it are ours", () => {
  expect(["hata.local", "memos.hata.local", "a.b.hata.local", "nothata.local", "other.local", "local"].map(ours)).toEqual([true, true, false, false, false, false]);
  // multicast DNS knows no other ending
  expect(["hata.local", "hata.lan", "local.example.com", ""].map(answersItself)).toEqual([true, false, false, false]);
});

test("an address question is answered with this machine's address, and nothing else is answered", () => {
  const answer = answerQuery(parseQuery(query([["memos.hata.local", 1], ["printer.local", 1]]))!, ours, "192.168.1.20")!;
  // a response, authoritative; no question, one record
  expect([...answer.subarray(0, 8)]).toEqual([0, 0, 0x84, 0, 0, 0, 0, 1]);
  const name = [5, ...new TextEncoder().encode("memos"), 4, ...new TextEncoder().encode("hata"), 5, ...new TextEncoder().encode("local"), 0];
  // type A, class IN with the flush bit, 120 s, four bytes of address
  expect([...answer.subarray(12)]).toEqual([...name, 0, 1, 0x80, 1, 0, 0, 0, 120, 0, 4, 192, 168, 1, 20]);
  expect(answerQuery(parseQuery(query([["printer.local", 1], ["hata.local", 12]]))!, ours, "192.168.1.20")).toBeNull();
  expect(answerQuery(parseQuery(query([["hata.local", 1]]))!, ours, "not an address")).toBeNull();
});

test("a question for the IPv6 address is told there is only an IPv4 one", () => {
  const answer = answerQuery(parseQuery(query([["hata.local", 28]]))!, ours, "10.0.0.2")!;
  const name = [4, ...new TextEncoder().encode("hata"), 5, ...new TextEncoder().encode("local"), 0];
  expect([...answer.subarray(12)]).toEqual([...name, 0, 47, 0x80, 1, 0, 0, 0, 120, 0, name.length + 3, ...name, 0, 1, 0x40]);
});

test("an ordinary DNS client gets its id and question back, and a short-lived answer", () => {
  const answer = answerQuery(parseQuery(query([["hata.local", 1]], 0x1234))!, ours, "10.0.0.2", true)!;
  const name = [4, ...new TextEncoder().encode("hata"), 5, ...new TextEncoder().encode("local"), 0];
  expect([...answer]).toEqual([0x12, 0x34, 0x84, 0, 0, 1, 0, 1, 0, 0, 0, 0, ...name, 0, 1, 0, 1, ...name, 0, 1, 0, 1, 0, 0, 0, 10, 0, 4, 10, 0, 0, 2]);
});

test("the address given is the one on the asker's network", () => {
  const links = [{ address: "192.168.1.20", netmask: "255.255.255.0" }, { address: "10.8.0.1", netmask: "255.255.0.0" }, { address: "203.0.113.200", netmask: "255.255.255.128" }];
  expect(addressFor("192.168.1.77", links)).toBe("192.168.1.20");
  expect(addressFor("10.8.200.3", links)).toBe("10.8.0.1");
  expect(addressFor("203.0.113.129", links)).toBe("203.0.113.200");
  expect(addressFor("203.0.113.5", links)).toBeNull();
  expect(addressFor("172.17.0.2", links)).toBeNull();
});

// --- Services (DNS-SD) ---

const text = (s: string) => [...new TextEncoder().encode(s)];
const wire = (name: string) => [...name.split(".").flatMap((label) => [label.length, ...text(label)]), 0];
const offer = { host: "hata.local", services: [{ type: "_smb._tcp", port: 445 }, { type: "_device-info._tcp", port: 0, txt: ["model=RackMac"] }] };

/** The records of a response, read back: name, type, class, ttl and data of each, answers then extras */
function records(packet: Uint8Array) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const out: { name: string; type: number; cls: number; ttl: number; data: number[] }[] = [];
  let at = 12;
  for (let i = 0; i < view.getUint16(6) + view.getUint16(10); i++) {
    const labels: string[] = [];
    for (; packet[at]; at += 1 + packet[at]!) labels.push(new TextDecoder().decode(packet.subarray(at + 1, at + 1 + packet[at]!)));
    at++;
    const length = view.getUint16(at + 8);
    out.push({ name: labels.join("."), type: view.getUint16(at), cls: view.getUint16(at + 2), ttl: view.getUint32(at + 4), data: [...packet.subarray(at + 10, at + 10 + length)] });
    at += 10 + length;
  }
  expect(at).toBe(packet.length);
  return { answers: out.slice(0, view.getUint16(6)), extras: out.slice(view.getUint16(6)) };
}

test("whoever browses for shared folders is told who serves them, and where, in one packet", () => {
  const { answers, extras } = records(answerQuery(parseQuery(query([["_smb._tcp.local", 12]]))!, ours, "192.168.1.20", false, offer)!);
  // the pointer may be held by others too: no flush bit
  expect(answers).toEqual([{ name: "_smb._tcp.local", type: 12, cls: 1, ttl: 120, data: wire("hata._smb._tcp.local") }]);
  expect(extras).toEqual([
    { name: "hata._smb._tcp.local", type: 33, cls: 0x8001, ttl: 120, data: [0, 0, 0, 0, 445 >> 8, 445 & 255, ...wire("hata.local")] },
    { name: "hata._smb._tcp.local", type: 16, cls: 0x8001, ttl: 120, data: [0] },
    { name: "hata.local", type: 1, cls: 0x8001, ttl: 120, data: [192, 168, 1, 20] },
  ]);
});

test("the kinds of services are listed; a description alone is not a kind to browse", () => {
  const { answers, extras } = records(answerQuery(parseQuery(query([["_services._dns-sd._udp.local", 12]]))!, ours, "10.0.0.2", false, offer)!);
  expect(answers).toEqual([{ name: "_services._dns-sd._udp.local", type: 12, cls: 1, ttl: 120, data: wire("_smb._tcp.local") }]);
  expect(extras).toEqual([]);
  expect(answerQuery(parseQuery(query([["_device-info._tcp.local", 12]]))!, ours, "10.0.0.2", false, offer)).toBeNull();
});

test("a service is asked about by its own name: where it is, what it says of itself", () => {
  const srv = records(answerQuery(parseQuery(query([["Hata._smb._tcp.local", 33]]))!, ours, "10.0.0.2", false, offer)!);
  expect(srv.answers.map((r) => r.type)).toEqual([33]);
  expect(srv.extras.map((r) => [r.name, r.type])).toEqual([["hata.local", 1]]);
  const info = records(answerQuery(parseQuery(query([["hata._device-info._tcp.local", 16]]))!, ours, "10.0.0.2", false, offer)!);
  expect(info.answers).toEqual([{ name: "hata._device-info._tcp.local", type: 16, cls: 0x8001, ttl: 120, data: [13, ...text("model=RackMac")] }]);
  // nothing to connect to there
  expect(answerQuery(parseQuery(query([["hata._device-info._tcp.local", 33]]))!, ours, "10.0.0.2", false, offer)).toBeNull();
  // somebody else's, and ours when nothing is offered
  expect(answerQuery(parseQuery(query([["nas._smb._tcp.local", 33]]))!, ours, "10.0.0.2", false, offer)).toBeNull();
  expect(answerQuery(parseQuery(query([["_smb._tcp.local", 12]]))!, ours, "10.0.0.2", false, { host: "hata.local", services: [] })).toBeNull();
  expect(answerQuery(parseQuery(query([["_smb._tcp.local", 12]]))!, ours, "10.0.0.2")).toBeNull();
});

test("everything is said at once unasked, and a service is taken back without the machine's name", () => {
  const said = records(announcement("hata.local", offer.services, "10.0.0.2")!);
  expect(said.answers.map((r) => [r.name, r.type, r.ttl])).toEqual([
    ["hata.local", 1, 120],
    ["_smb._tcp.local", 12, 120],
    ["hata._smb._tcp.local", 33, 120],
    ["hata._smb._tcp.local", 16, 120],
    ["hata._device-info._tcp.local", 16, 120],
  ]);
  expect(said.extras).toEqual([]);
  expect(records(announcement("hata.local", [], "10.0.0.2")!).answers.map((r) => r.type)).toEqual([1]);
  const gone = records(announcement("hata.local", offer.services, "10.0.0.2", 0)!);
  expect(gone.answers.every((r) => r.ttl === 0)).toBe(true);
  expect([...gone.answers, ...gone.extras].some((r) => r.type === 1)).toBe(false);
});
