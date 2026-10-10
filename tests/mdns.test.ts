import { expect, test } from "bun:test";
import { addressFor, answerQuery, isLocalName, parseQuery } from "../src/mdns";

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
