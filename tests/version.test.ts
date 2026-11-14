import { expect, test } from "bun:test";
import { VERSION } from "../src/version";
import pack from "../package.json";

test("package.json names the version the code does", () => {
  expect(pack.version).toBe(VERSION);
});
