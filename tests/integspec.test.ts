import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { atLeast, chosen, fill, fillJson, rowsOf, target, valuesOf } from "../src/integ/data";
import { readSpec, SpecError } from "../src/integ/spec";

const seed = (name: string) => readSpec(Bun.YAML.parse(readFileSync(join(import.meta.dir, "../src/integ/seeds", `${name}.yml`), "utf8")));

test("the descriptions Hata carries are read whole", () => {
  expect(seed("qbittorrent").id).toBe("qbittorrent");
  expect(seed("frigate").pictures.live!.stream).toBe(true);
});

test("a description that reaches outside the service, or names what is not there, is refused with every reason", () => {
  const base = Bun.YAML.parse(readFileSync(join(import.meta.dir, "../src/integ/seeds/qbittorrent.yml"), "utf8")) as any;
  const bad = structuredClone(base);
  bad.signIn.check.request.path = "//evil.example/x";
  bad.read.torrents.request.path = "/api/../../etc";
  bad.signIn.headers = { Cookie: "x" };
  bad.actions.remove.confirm = undefined;
  bad.page[1].table.columns[0].field = "nope";
  try {
    readSpec(bad);
    throw new Error("read");
  } catch (e) {
    expect(e).toBeInstanceOf(SpecError);
    const said = (e as SpecError).problems.join("\n");
    expect(said).toContain("signIn.check.request.path");
    expect(said).toContain("read.torrents.request.path");
    expect(said).toContain("signIn.headers.Cookie");
    expect(said).toContain("actions.remove.confirm");
    expect(said).toContain("columns[0].field");
  }
});

test("qBittorrent's torrents become rows, and the values add them up", () => {
  const spec = seed("qbittorrent");
  const answer = [
    { hash: "a".repeat(40), name: "One", state: "stalledDL", progress: 0.5, size: 100, dlspeed: 0, upspeed: 0, eta: 8640000, ratio: 0.123, added_on: 10, save_path: "/d" },
    { hash: "b".repeat(40), name: "Two", state: "uploading", progress: 1, size: 50, dlspeed: 0, upspeed: 300, eta: 5, ratio: 2, added_on: 20, save_path: "/d" },
    { hash: "c".repeat(40), name: "Bad", state: "missingFiles", progress: 0.2, size: 1, dlspeed: 0, upspeed: 0, eta: 0, ratio: 0, added_on: 30, save_path: "/d" },
    { name: "no hash" },
  ];
  const rows = rowsOf(spec.read.torrents!, answer, {});
  expect(rows).toHaveLength(3);
  expect(rows[0]).toMatchObject({ group: "downloading", status: "waiting", tab: "downloading", percent: 50, eta: null, moving: false, added: 10_000 });
  expect(rows[1]).toMatchObject({ group: "seeding", tab: "seeding", moving: true, ratio: 2 });
  expect(rows[2]).toMatchObject({ group: "error", tab: "error" });
  const values = valuesOf(spec, { check: "2.11.4", torrents: rows });
  expect(values).toMatchObject({ webApi: "2.11.4", up: 300, total: 3, active: 1, failed: 1, firstFailed: "Bad" });
  expect(chosen(spec.actions.pause!.requests, values)!.path).toBe("/api/v2/torrents/stop");
  expect(chosen(spec.actions.pause!.requests, { webApi: "2.9" })!.path).toBe("/api/v2/torrents/pause");
  expect(fill(spec.actions.pause!.requests[0]!.form!.hashes!, { ids: ["x", "y"] })).toBe("x|y");
});

test("Frigate's cameras are the config's entries, their frames from the stats", () => {
  const spec = seed("frigate");
  const answers: Record<string, unknown> = {
    config: { cameras: { yard: { enabled: true }, room: { enabled: false }, gate: {} } },
    stats: { cameras: { yard: { camera_fps: 5 }, gate: { camera_fps: 0 } } },
  };
  const rows = rowsOf(spec.read.cameras!, answers.config, answers);
  expect(rows.map((r) => [r.name, r.enabled, r.fps, r.online])).toEqual([
    ["yard", true, 5, true],
    ["room", false, null, false],
    ["gate", true, 0, false],
  ]);
  const events = rowsOf(spec.read.events!, [{ id: "1.2-ab", camera: "yard", label: "person", sub_label: null, data: { top_score: 0.834 }, start_time: 3, end_time: null, has_snapshot: true }], answers);
  expect(events[0]).toMatchObject({ label: "person", score: 83, start: 3000, end: null, going: true, snapshot: true });
});

test("places are encoded in a path and a query; an empty one leaves its parameter out", () => {
  expect(target({ method: "GET", path: "/api/{name}/latest.jpg", query: { h: "{height}" } }, { name: "a/b?c", height: 360 })).toBe("/api/a%2Fb%3Fc/latest.jpg?h=360");
  expect(target({ method: "GET", path: "/api/events", query: { limit: "{limit}", cameras: "{camera}" } }, { limit: 12 })).toBe("/api/events?limit=12");
  expect(fillJson({ ids: "{ids}", n: "{n}", s: "x {n}" }, { ids: [1, 2], n: 3 })).toEqual({ ids: [1, 2], n: 3, s: "x 3" });
  expect(atLeast("v2.11.4", "2.11")).toBe(true);
  expect(atLeast("2.9", "2.11")).toBe(false);
});
