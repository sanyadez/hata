import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import en from "../src/lang/en.json";

const dir = join(import.meta.dir, "../src/lang");
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "en.json")) {
  test(`${file} has the same keys and placeholders as en.json`, async () => {
    const dict: Record<string, string> = await Bun.file(join(dir, file)).json();
    expect(Object.keys(dict).sort()).toEqual(Object.keys(en).sort());
    for (const [key, text] of Object.entries(en)) expect([key, placeholders(dict[key]!)]).toEqual([key, placeholders(text)]);
  });
}

test("every string the UI asks for exists", async () => {
  const js = await Bun.file(join(import.meta.dir, "../src/ui/app.js")).text();
  const used = [...js.matchAll(/\bt\("([a-zA-Z.]+)"/g)].map((m) => m[1]!).filter((k) => !k.endsWith("."));
  expect(used.filter((key) => !(key in en))).toEqual([]);
});
