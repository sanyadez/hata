import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkTarget, movedStateDir } from "../src/statedir";

test("where the configuration folder may be moved", () => {
  const from = "/var/lib/hata";
  expect(checkTarget("/mnt/disk/hata/", from)).toEqual({ path: "/mnt/disk/hata" });
  expect(checkTarget(" /DATA/Hata ", from)).toEqual({ path: "/DATA/Hata" });
  for (const bad of ["", "hata", "/", "/etc/hata", "/tmp/x", "/usr/local/hata", "/mnt/../etc", "/a\nb", 5, null]) expect(checkTarget(bad, from)).toEqual({ error: "state.badPath" });
  expect(checkTarget("/var/lib/hata/", from)).toEqual({ error: "state.samePath" });
  expect(checkTarget("/var/lib/hata/inner", from)).toEqual({ error: "state.nested" });
  expect(checkTarget("/var/lib", from)).toEqual({ error: "state.nested" });
  // a name that only begins the same is another folder
  expect(checkTarget("/var/lib/hata2", from)).toEqual({ path: "/var/lib/hata2" });
});

test("the pointer names the folder the state was moved to", () => {
  const dir = mkdtempSync(join(tmpdir(), "hata-pointer-"));
  const pointer = join(dir, "state-dir");
  expect(movedStateDir(pointer)).toBeNull();
  writeFileSync(pointer, "/mnt/disk/hata/\n");
  expect(movedStateDir(pointer)).toBe("/mnt/disk/hata");
  for (const bad of ["", "relative/path\n", "/\n"]) {
    writeFileSync(pointer, bad);
    expect(movedStateDir(pointer)).toBeNull();
  }
});
