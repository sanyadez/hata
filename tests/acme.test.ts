import { expect, test } from "bun:test";
import { certificateRequest, der } from "../src/acme";

test("DER lengths: short, one byte, two bytes", () => {
  expect([...der(0x04, [1, 2, 3])]).toEqual([0x04, 3, 1, 2, 3]);
  expect([...der(0x04, new Uint8Array(200)).slice(0, 3)]).toEqual([0x04, 0x81, 200]);
  expect([...der(0x04, new Uint8Array(300)).slice(0, 4)]).toEqual([0x04, 0x82, 1, 44]);
  expect([...der(0x30, der(0x02, [5]), [0x05, 0x00])]).toEqual([0x30, 5, 0x02, 1, 5, 0x05, 0x00]);
});

test("a certificate request names the host and carries a signature that verifies", async () => {
  // OpenSSL accepts these requests (checked by hand); here we check what can be checked without it
  for (let i = 0; i < 25; i++) {
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const csr = await certificateRequest("photos.home.example.com", keys);
    expect(csr[0]).toBe(0x30);
    const text = new TextDecoder("latin1").decode(csr);
    expect(text.split("photos.home.example.com").length).toBe(3); // subject and alternative name

    // outer SEQUENCE { info, algorithm, BIT STRING { 0, SEQUENCE { INTEGER r, INTEGER s } } }
    const outerHeader = csr[1]! < 128 ? 2 : 2 + (csr[1]! & 127);
    const infoLength = csr[outerHeader + 1]! === 0x81 ? csr[outerHeader + 2]! + 3 : csr[outerHeader + 1]! === 0x82 ? ((csr[outerHeader + 2]! << 8) | csr[outerHeader + 3]!) + 4 : csr[outerHeader + 1]! + 2;
    const info = csr.slice(outerHeader, outerHeader + infoLength);
    const rest = csr.slice(outerHeader + infoLength);
    const bitString = rest.slice(rest.indexOf(0x03, 2 + rest[1]!));
    const sequence = bitString.slice(3);
    expect(sequence[0]).toBe(0x30);
    const integer = (at: number) => {
      const length = sequence[at + 1]!;
      const bytes = sequence.slice(at + 2, at + 2 + length);
      // a DER integer is never longer than needed: no leading zero unless the next byte has its top bit set
      if (bytes.length > 1 && bytes[0] === 0) expect(bytes[1]! & 0x80).toBe(0x80);
      const raw = new Uint8Array(32);
      const trimmed = bytes[0] === 0 ? bytes.slice(1) : bytes;
      raw.set(trimmed, 32 - trimmed.length);
      return { raw, next: at + 2 + length };
    };
    const r = integer(2);
    const s = integer(r.next);
    const signature = new Uint8Array([...r.raw, ...s.raw]);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, keys.publicKey, signature, info)).toBe(true);
  }
});
