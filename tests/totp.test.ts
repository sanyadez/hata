import { expect, test } from "bun:test";
import { qrMatrix, versionFor } from "../src/qr";
import { base32Decode, base32Encode, newSecret, otpauthUri, stepAt, totp, verifyTotp } from "../src/totp";

// RFC 6238, appendix B: the SHA-1 secret is the ASCII string "12345678901234567890"
const RFC_SECRET = base32Encode(new TextEncoder().encode("12345678901234567890"));

test("base32 round trip", () => {
  expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  expect(new TextDecoder().decode(base32Decode("gezd gnbv-gy3t qojq"))).toBe("1234567890");
  for (const length of [1, 2, 3, 4, 5, 19, 20]) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    expect([...base32Decode(base32Encode(bytes))]).toEqual([...bytes]);
  }
  expect(() => base32Decode("not base 32!")).toThrow();
  expect(newSecret()).toMatch(/^[A-Z2-7]{32}$/);
});

test("codes match the RFC 6238 test vectors (last six digits)", () => {
  const vectors: [number, string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ];
  for (const [seconds, code] of vectors) expect(totp(RFC_SECRET, stepAt(seconds * 1000))).toBe(code);
});

test("a code is accepted in its step and the neighbouring ones, and only once", () => {
  const now = 1234567890 * 1000;
  const step = stepAt(now);
  expect(verifyTotp(RFC_SECRET, "005924", now)).toBe(step);
  expect(verifyTotp(RFC_SECRET, " 005 924 ", now)).toBe(step);
  expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, step - 1), now)).toBe(step - 1);
  expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, step + 1), now)).toBe(step + 1);
  expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, step - 2), now)).toBeNull();
  expect(verifyTotp(RFC_SECRET, "000000", now)).toBeNull();
  expect(verifyTotp(RFC_SECRET, "12345", now)).toBeNull();
  // replay: the same code a second time
  expect(verifyTotp(RFC_SECRET, "005924", now, step)).toBeNull();
});

test("the setup link names the account and the issuer", () => {
  expect(otpauthUri("anna k", "ABC")).toBe("otpauth://totp/Hata:anna%20k?secret=ABC&issuer=Hata");
});

// This matrix was decoded back to "hello" by an independent QR decoder; it pins the encoder's output.
const HELLO = ["111111100110001111111", "100000101100001000001", "101110100101101011101"];

test("QR code: structure, a pinned sample, sizes and the length limit", () => {
  const m = qrMatrix("hello");
  const rows = m.map((row) => row.map((dark) => (dark ? "1" : "0")).join(""));
  expect(rows.length).toBe(21);
  expect(rows.slice(0, 3)).toEqual(HELLO);
  // the three finder patterns and the timing row
  for (const [r, c] of [[0, 0], [0, 14], [14, 0]] as const) {
    expect(rows.slice(r, r + 7).map((row) => row.slice(c, c + 7))).toEqual(["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"]);
  }
  expect(rows[6]!.slice(8, 13)).toBe("10101");
  expect(m[13]![8]).toBe(true);
  expect(versionFor(14)).toBe(1);
  expect(versionFor(15)).toBe(2);
  expect(versionFor(213)).toBe(10);
  expect(versionFor(214)).toBeNull();
  expect(qrMatrix("x".repeat(213)).length).toBe(57);
  expect(() => qrMatrix("x".repeat(214))).toThrow();
  // same input, same code
  expect(qrMatrix("hello")).toEqual(m);
});
