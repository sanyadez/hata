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
  const used = [...js.matchAll(/\bt\("([a-zA-Z.]+)"/g)].map((m) => m[1]!);
  // a key ending with a dot is a prefix completed at run time: at least one such string must exist
  const missing = used.filter((key) => (key.endsWith(".") ? !Object.keys(en).some((k) => k.startsWith(key)) : !(key in en)));
  expect(missing).toEqual([]);
});

test("strings chosen at run time exist for every value the server can send", () => {
  const need = [
    ...["running", "partial", "restarting", "stopped", "unknown", "busy"].map((s) => `status.${s}`),
    ...["install", "update", "start", "stop", "restart", "remove", "apply", "backup", "restore"].flatMap((k) => [`job.${k}`, `activity.app.${k}.done`, `activity.app.${k}.failed`]),
    ...["docker", "restarting", "partial", "disk", "memory", "temperature", "failed.install", "failed.update", "failed.apply", "failed.start", "failed.backup", "failed.restore"].flatMap((c) => [`attention.${c}.title`, `attention.${c}.text`]),
    ...["home", "store", "backups", "users", "settings"].map((v) => `nav.${v}`),
    ...["admin", "member", "guest"].map((v) => `user.role.${v}`),
    ...["ok", "wrongPassword", "wrongCode", "locked"].map((v) => `signins.${v}`),
    ...["noPort", "hostNetwork"].map((v) => `access.cannot.${v}`),
    ...["manual", "schedule", "pre-update"].map((v) => `backup.reason.${v}`),
    ...["account", "general", "apps", "stores", "about"].map((v) => `settings.${v}`),
    ...["overview", "logs", "compose", "backups"].map((v) => `app.tab.${v}`),
  ];
  expect(need.filter((key) => !(key in en))).toEqual([]);
});
