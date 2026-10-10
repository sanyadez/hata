/**
 * Files sealed with a passphrase: what a backup looks like on a machine that is not ours.
 *
 * The format is small and has no options. A header — `HATASEAL`, a version byte, a 16-byte salt, the
 * PBKDF2 iteration count and the chunk size (both 32-bit, big-endian) — is followed by the file cut into
 * chunks, each encrypted with AES-256-GCM (so each is 16 bytes longer). The key is PBKDF2-SHA-256 of the
 * passphrase and the salt; the nonce of a chunk is its number with a last byte of 1 for the final chunk,
 * so a file cut short or put together from pieces does not open. An empty file is one empty final chunk.
 *
 * Pure but for the files it is pointed at: the command line uses it before there is any state.
 */
import { closeSync, openSync, readSync, renameSync, rmSync, statSync, writeSync } from "node:fs";

export const SEALED_EXT = ".enc";

const MAGIC = new TextEncoder().encode("HATASEAL");
const VERSION = 1;
const HEADER_SIZE = MAGIC.length + 1 + 16 + 4 + 4;
const TAG_SIZE = 16;
const CHUNK_SIZE = 1024 * 1024;
const ITERATIONS = 600_000;
/** What a header may ask for: a damaged or hostile one must not make us allocate or spin without end */
const MAX_CHUNK_SIZE = 64 * 1024 * 1024;
const MAX_ITERATIONS = 10_000_000;

export class SealError extends Error {}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function nonce(index: number, final: boolean): Uint8Array {
  const out = new Uint8Array(12);
  new DataView(out.buffer).setBigUint64(3, BigInt(index));
  out[11] = final ? 1 : 0;
  return out;
}

function header(salt: Uint8Array, iterations: number, chunkSize: number): Uint8Array {
  const out = new Uint8Array(HEADER_SIZE);
  out.set(MAGIC);
  out[MAGIC.length] = VERSION;
  out.set(salt, MAGIC.length + 1);
  const view = new DataView(out.buffer);
  view.setUint32(MAGIC.length + 17, iterations);
  view.setUint32(MAGIC.length + 21, chunkSize);
  return out;
}

function readFull(fd: number, buffer: Uint8Array, position: number): number {
  let got = 0;
  while (got < buffer.length) {
    const n = readSync(fd, buffer, got, buffer.length - got, position + got);
    if (n === 0) break;
    got += n;
  }
  return got;
}

/** Runs `work` between an open source and a new target; the target appears only when it is whole */
async function transform(from: string, to: string, work: (source: number, target: number, size: number) => Promise<void>): Promise<void> {
  const partial = to + ".partial";
  const source = openSync(from, "r");
  let target: number | null = null;
  try {
    target = openSync(partial, "w", 0o600);
    await work(source, target, statSync(from).size);
    closeSync(target);
    target = null;
    renameSync(partial, to);
  } catch (e) {
    if (target !== null) closeSync(target);
    rmSync(partial, { force: true });
    throw e;
  } finally {
    closeSync(source);
  }
}

/** Seals `from` into `to`. `chunkSize` and `iterations` are for tests: files are always written with the defaults */
export async function sealFile(from: string, to: string, passphrase: string, chunkSize = CHUNK_SIZE, iterations = ITERATIONS): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt, iterations);
  await transform(from, to, async (source, target, size) => {
    writeSync(target, header(salt, iterations, chunkSize));
    const buffer = new Uint8Array(chunkSize);
    let position = 0;
    for (let index = 0; ; index++) {
      const got = readFull(source, buffer, position);
      position += got;
      const final = position >= size;
      const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce(index, final) }, key, buffer.subarray(0, got));
      writeSync(target, new Uint8Array(sealed));
      if (final) break;
    }
  });
}

/** Opens what `sealFile` made. Throws `SealError` for a wrong passphrase and for a file that is not whole */
export async function openFile(from: string, to: string, passphrase: string): Promise<void> {
  await transform(from, to, async (source, target, size) => {
    const head = new Uint8Array(HEADER_SIZE);
    if (readFull(source, head, 0) < HEADER_SIZE || MAGIC.some((byte, i) => head[i] !== byte)) throw new SealError("This is not a file sealed by Hata.");
    if (head[MAGIC.length] !== VERSION) throw new SealError("The file was sealed by a newer version of Hata.");
    const view = new DataView(head.buffer);
    const iterations = view.getUint32(MAGIC.length + 17);
    const chunkSize = view.getUint32(MAGIC.length + 21);
    if (!chunkSize || chunkSize > MAX_CHUNK_SIZE || !iterations || iterations > MAX_ITERATIONS) throw new SealError("The file is damaged.");
    const key = await deriveKey(passphrase, head.subarray(MAGIC.length + 1, MAGIC.length + 17), iterations);
    const buffer = new Uint8Array(chunkSize + TAG_SIZE);
    let position = HEADER_SIZE;
    for (let index = 0; ; index++) {
      const got = readFull(source, buffer, position);
      position += got;
      const final = position >= size;
      let plain: ArrayBuffer;
      try {
        plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce(index, final) }, key, buffer.subarray(0, got));
      } catch {
        throw new SealError(index === 0 ? "The passphrase is wrong, or the file is damaged." : "The file is damaged or not whole.");
      }
      writeSync(target, new Uint8Array(plain));
      if (final) break;
    }
  });
}
