/**
 * Time-based one-time passwords (RFC 6238) — the six digits of an authenticator app.
 * HMAC-SHA1, 30-second steps, as every authenticator app expects by default.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Not base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A new secret: 160 bits, as the RFC recommends */
export const newSecret = (): string => base32Encode(crypto.getRandomValues(new Uint8Array(20)));

export const stepAt = (ms: number): number => Math.floor(ms / 1000 / STEP_SECONDS);

/** The code of a time step */
export function totp(secret: string, step: number): string {
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(step));
  const mac = new Bun.CryptoHasher("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  const number = ((mac[offset]! & 127) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(number % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * The time step a code belongs to, or null if it is wrong. The steps just before and after the current
 * one are accepted (clocks drift); a step at or before `lastUsed` is not — a code works once.
 */
export function verifyTotp(secret: string, code: string, now: number, lastUsed = -1): number | null {
  const digits = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  const current = stepAt(now);
  for (const step of [current, current - 1, current + 1]) {
    if (step > lastUsed && crypto.timingSafeEqual(Buffer.from(totp(secret, step)), Buffer.from(digits))) return step;
  }
  return null;
}

/** What an authenticator app reads from the QR code */
export function otpauthUri(account: string, secret: string, issuer = "Hata"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
}
