import { expect, test } from "bun:test";
import { checksumFor, compareVersions, pickRelease } from "../src/update";

test("versions are compared the semver way", () => {
  const order = ["0.1.0-alpha.2", "0.1.0-alpha.3", "0.1.0-alpha.10", "0.1.0-beta", "0.1.0-rc.1", "0.1.0", "0.1.1", "0.2.0-alpha.1", "0.2.0", "0.10.0", "1.0.0"];
  for (let i = 0; i < order.length; i++) {
    for (let j = 0; j < order.length; j++) expect([order[i], order[j], Math.sign(compareVersions(order[i]!, order[j]!))]).toEqual([order[i], order[j], Math.sign(i - j)]);
  }
  expect(compareVersions("v0.1.0", "0.1.0")).toBe(0);
  expect(compareVersions("0.1.0+build5", "0.1.0")).toBe(0);
  expect(compareVersions("0.1.0-alpha", "0.1.0-alpha.1")).toBeLessThan(0);
});

test("the checksum of a file out of SHA256SUMS", () => {
  const sums = `${"a".repeat(64)}  hata-linux-x64\n${"b".repeat(64)} *hata-linux-arm64\nnot a line\n`;
  expect(checksumFor(sums, "hata-linux-x64")).toBe("a".repeat(64));
  expect(checksumFor(sums, "hata-linux-arm64")).toBe("b".repeat(64));
  expect(checksumFor(sums, "hata-linux-riscv")).toBe("");
});

test("a channel offers the highest release it may: stable skips pre-releases and drafts", () => {
  const list = [
    { tag_name: "v0.23.0", draft: true },
    { tag_name: "v0.22.0-beta.2", prerelease: true },
    { tag_name: "v0.22.0-beta.10", prerelease: true },
    { tag_name: "v0.21.1-rc.1" },
    { tag_name: "v0.21.0" },
    { tag_name: "v0.20.0" },
    { name: "no tag" },
  ];
  expect(pickRelease(list, "stable")?.tag_name).toBe("v0.21.0");
  expect(pickRelease(list, "beta")?.tag_name).toBe("v0.22.0-beta.10");
  // the stable release outranks its own pre-releases
  expect(pickRelease([...list, { tag_name: "v0.22.0" }], "beta")?.tag_name).toBe("v0.22.0");
  expect(pickRelease([{ tag_name: "v0.22.0-beta.1", prerelease: true }], "stable")).toBeNull();
  expect(pickRelease([], "beta")).toBeNull();
});
