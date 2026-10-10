import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openFile, SealError, sealFile } from "../src/seal";

const dir = mkdtempSync(join(tmpdir(), "hata-seal-"));
const CHUNK = 64;
const ITERATIONS = 1000;
const HEADER = 33;

async function sealed(name: string, content: Uint8Array, passphrase = "correct horse"): Promise<string> {
  writeFileSync(join(dir, name), content);
  await sealFile(join(dir, name), join(dir, name + ".enc"), passphrase, CHUNK, ITERATIONS);
  return join(dir, name + ".enc");
}

const bytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

test("a sealed file opens to what it was, whatever its length", async () => {
  for (const length of [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, CHUNK * 3, CHUNK * 3 + 7]) {
    const content = bytes(length);
    const file = await sealed(`len-${length}`, content);
    expect(readFileSync(file).length).toBe(HEADER + length + 16 * Math.max(1, Math.ceil(length / CHUNK)));
    await openFile(file, join(dir, `len-${length}.out`), "correct horse");
    expect(new Uint8Array(readFileSync(join(dir, `len-${length}.out`)))).toEqual(content);
  }
});

test("the content does not show through, and two seals of one file differ", async () => {
  const content = new TextEncoder().encode("the same line again and again ".repeat(20));
  const a = readFileSync(await sealed("a", content));
  const b = readFileSync(await sealed("b", content));
  expect(a.includes("the same line")).toBe(false);
  expect(a.equals(b)).toBe(false);
});

test("a wrong passphrase opens nothing and leaves nothing behind", async () => {
  const file = await sealed("secret", bytes(200));
  const out = join(dir, "secret.out");
  expect(openFile(file, out, "wrong")).rejects.toBeInstanceOf(SealError);
  await openFile(file, out, "wrong").catch(() => {});
  expect(existsSync(out)).toBe(false);
  expect(existsSync(out + ".partial")).toBe(false);
});

test("a changed, shortened, lengthened or reordered file does not open", async () => {
  const file = await sealed("whole", bytes(CHUNK * 3));
  const whole = readFileSync(file);
  const sealedChunk = CHUNK + 16;
  const attempt = async (name: string, damaged: Uint8Array) => {
    writeFileSync(join(dir, name), damaged);
    return openFile(join(dir, name), join(dir, name + ".out"), "correct horse").then(
      () => "opened",
      (e) => (e instanceof SealError ? "refused" : "crashed"),
    );
  };

  const flipped = new Uint8Array(whole);
  flipped[HEADER + 5]! ^= 1;
  expect(await attempt("flipped", flipped)).toBe("refused");
  // cut at a chunk boundary: every chunk left is intact, but the last one is not the final one
  expect(await attempt("cut", whole.subarray(0, HEADER + sealedChunk * 2))).toBe("refused");
  expect(await attempt("cut-mid", whole.subarray(0, whole.length - 3))).toBe("refused");
  expect(await attempt("longer", Buffer.concat([whole, whole.subarray(HEADER, HEADER + sealedChunk)]))).toBe("refused");
  const swapped = new Uint8Array(whole);
  swapped.set(whole.subarray(HEADER + sealedChunk, HEADER + sealedChunk * 2), HEADER);
  swapped.set(whole.subarray(HEADER, HEADER + sealedChunk), HEADER + sealedChunk);
  expect(await attempt("swapped", swapped)).toBe("refused");
  expect(await attempt("not-ours", new TextEncoder().encode("just a text file, longer than a header would be"))).toBe("refused");
  expect(await attempt("empty", new Uint8Array(0))).toBe("refused");
});
