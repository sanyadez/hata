import { expect, test } from "bun:test";
import { checksumFor, compareVersions } from "../src/update";

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
