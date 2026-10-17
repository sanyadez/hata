import { expect, test } from "bun:test";
import { acceptFor, BINARY, encodeFrame, FrameReader, PING, sized, TEXT, typed } from "../src/wsframe";

const unmask = (frame: Uint8Array, head: number) => frame.slice(head + 4).map((x, i) => x ^ frame[head + (i % 4)]!);

test("a client's frame is final and masked, its length in the right width", () => {
  const mask = new Uint8Array([1, 2, 3, 4]);
  const small = encodeFrame(TEXT, new TextEncoder().encode("hi"), mask);
  expect([...small.slice(0, 2)]).toEqual([0x81, 0x82]);
  expect(new TextDecoder().decode(unmask(small, 2))).toBe("hi");
  const mid = encodeFrame(BINARY, new Uint8Array(300), mask);
  expect([...mid.slice(0, 4)]).toEqual([0x82, 0xfe, 1, 44]);
  const big = encodeFrame(BINARY, new Uint8Array(70000), mask);
  expect(big[1]).toBe(0xff);
  expect(new DataView(big.buffer).getBigUint64(2)).toBe(70000n);
});

test("the server's frames read from pieces, fragments joined, control frames between them", () => {
  const frame = (fin: boolean, op: number, data: number[]) => new Uint8Array([(fin ? 0x80 : 0) | op, data.length, ...data]);
  const r = new FrameReader();
  const all = new Uint8Array([...frame(false, BINARY, [1, 2]), ...frame(true, PING, [9]), ...frame(true, 0, [3]), ...frame(true, TEXT, [0x4f, 0x4b])]);
  const out = [...r.push(all.slice(0, 3)), ...r.push(all.slice(3, 7)), ...r.push(all.slice(7))];
  expect(out.map((f) => [f.opcode, [...f.data]])).toEqual([[PING, [9]], [BINARY, [1, 2, 3]], [TEXT, [0x4f, 0x4b]]]);
  const long = new Uint8Array([0x82, 126, 0, 200, ...new Uint8Array(200).fill(7)]);
  expect(r.push(long)[0]!.data.length).toBe(200);
});

test("the accept answer of the protocol's own example", async () => {
  expect(await acceptFor("dGhlIHNhbXBsZSBub25jZQ==")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

test("Proxmox's console words", () => {
  expect(new TextDecoder().decode(typed(new TextEncoder().encode("ї\r")))).toBe("0:3:ї\r");
  expect(sized(80, 24)).toBe("1:80:24:");
});
