import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveKind } from "../src/files";
import { decodeName, openZip, safeName } from "../src/unzip";
import { zipChunks } from "../src/zip";

test("names that would leave the folder are refused or made plain", () => {
  expect(safeName("a/b.txt")).toBe("a/b.txt");
  expect(safeName("/etc/passwd")).toBe("etc/passwd");
  expect(safeName("C:\\Users\\x.txt")).toBe("Users/x.txt");
  expect(safeName("./a//b/")).toBe("a/b");
  expect(safeName("../evil")).toBeNull();
  expect(safeName("a/../../evil")).toBeNull();
  expect(safeName("/")).toBeNull();
});

test("a name without the UTF-8 mark is read as UTF-8 when it is, else as the DOS code page", () => {
  expect(decodeName(new TextEncoder().encode("файл.txt"), false)).toBe("файл.txt");
  // "При" in CP866
  expect(decodeName(new Uint8Array([0x8f, 0xe0, 0xa8]), false)).toBe("При");
});

test("an archive written by Hata reads back whole", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hata-unzip-"));
  writeFileSync(join(dir, "a.txt"), "hello");
  writeFileSync(join(dir, "b.bin"), new Uint8Array(200_000).map((_, i) => i % 251));
  const parts: Uint8Array[] = [];
  for await (const chunk of zipChunks([{ name: "docs/" }, { name: "docs/a.txt", file: join(dir, "a.txt"), mode: 0o640 }, { name: "b.bin", file: join(dir, "b.bin") }])) parts.push(chunk);
  writeFileSync(join(dir, "t.zip"), Buffer.concat(parts));
  const zip = openZip(join(dir, "t.zip"));
  expect(zip.entries.map((e) => [e.name, e.dir, e.size])).toEqual([["docs", true, 0], ["docs/a.txt", false, 5], ["b.bin", false, 200_000]]);
  for (const entry of zip.entries.filter((e) => !e.dir)) await zip.extract(entry, join(dir, "out-" + entry.name.replace("/", "_")));
  zip.close();
  expect(readFileSync(join(dir, "out-docs_a.txt"), "utf8")).toBe("hello");
  expect(readFileSync(join(dir, "out-b.bin")).equals(readFileSync(join(dir, "b.bin")))).toBe(true);
  expect(() => openZip(join(dir, "a.txt"))).toThrow("not a ZIP archive");
});

test("which names are archives, and what they unpack under", () => {
  expect(archiveKind("photos.zip")).toEqual({ kind: "zip", stem: "photos" });
  expect(archiveKind("site.tar.gz")).toEqual({ kind: "tar", stem: "site" });
  expect(archiveKind("a.b.tgz")).toEqual({ kind: "tar", stem: "a.b" });
  expect(archiveKind("x.TAR.ZST")).toEqual({ kind: "tar", stem: "x" });
  expect(archiveKind("notes.txt")).toBeNull();
  expect(archiveKind(".zip")).toBeNull();
});
