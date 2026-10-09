import { expect, test } from "bun:test";
import { attention } from "../src/attention";
import { parseStats } from "../src/docker";
import type { InstalledApp } from "../src/apps";
import type { SystemStatus } from "../src/system";

const GB = 1024 ** 3;
const system = (over: Partial<SystemStatus> = {}): SystemStatus => ({
  hostname: "h",
  uptime: 1,
  cores: 4,
  load: [0, 0, 0],
  cpu: 5,
  memory: { total: 16 * GB, used: 4 * GB, swapTotal: 0, swapUsed: 0 },
  disks: [{ path: "/", total: 100 * GB, used: 40 * GB }],
  net: null,
  temperature: 45,
  history: { cpu: [], memory: [], net: [] },
  ...over,
});
const app = (name: string, status: InstalledApp["status"], states: string[] = ["running"]): InstalledApp => ({
  name,
  title: name.toUpperCase(),
  icon: "",
  port: "",
  index: "/",
  scheme: "http",
  hostname: "",
  status,
  store: "",
  protected: false,
  job: null,
  containers: states.map((state, i) => ({ id: String(i), name: `${name}-${i}`, service: "s", image: "i", state, status: state, ports: [] })),
});
const docker = { available: true, version: "1", compose: "2" };
const NOW = 1_000_000_000_000;
const codes = (input: Partial<Parameters<typeof attention>[0]>) => attention({ system: system(), docker, apps: [], activity: [], now: NOW, ...input }).map((i) => i.code);

test("a healthy server needs no attention", () => {
  expect(codes({ apps: [app("a", "running"), app("b", "stopped", ["exited"])] })).toEqual([]);
});

test("docker, restarting and partly running apps", () => {
  expect(codes({ docker: { available: false, error: "no socket" } })).toEqual(["docker"]);
  const items = attention({ system: system(), docker, apps: [app("slow", "partial", ["running", "exited"]), app("loop", "partial", ["restarting"])], activity: [], now: NOW });
  // what is broken now comes before what is merely degraded
  expect(items.map((i) => [i.code, i.app, i.severity])).toEqual([
    ["restarting", "loop", "danger"],
    ["partial", "slow", "warn"],
  ]);
  expect(items[1]!.detail.container).toBe("slow-1");
});

test("disk, memory and temperature thresholds", () => {
  expect(codes({ system: system({ disks: [{ path: "/", total: 100, used: 84 }] }) })).toEqual([]);
  const full = attention({ system: system({ disks: [{ path: "/", total: 100, used: 86 }, { path: "/DATA", total: 100, used: 97 }] }), docker, apps: [], activity: [], now: NOW });
  expect(full.map((i) => [i.detail.path, i.severity])).toEqual([["/DATA", "danger"], ["/", "warn"]]);
  expect(codes({ system: system({ memory: { total: 100, used: 95, swapTotal: 0, swapUsed: 0 } }) })).toEqual(["memory"]);
  expect(codes({ system: system({ temperature: 90 }) })).toEqual(["temperature"]);
  expect(codes({ system: system({ temperature: null }) })).toEqual([]);
});

test("a failed operation matters only while it is the latest word on the app", () => {
  const apps = [app("web", "running")];
  const failed = { ts: NOW - 1000, code: "app.update.failed", app: "web", detail: "pull denied" };
  expect(attention({ system: system(), docker, apps, activity: [failed], now: NOW })[0]).toMatchObject({ code: "failed.update", app: "web", detail: { title: "WEB", message: "pull denied" } });
  // newest first: a later success clears it
  expect(codes({ apps, activity: [{ ts: NOW - 500, code: "app.update.done", app: "web" }, failed] })).toEqual([]);
  expect(codes({ apps, activity: [{ ...failed, ts: NOW - 25 * 3600 * 1000 }] })).toEqual([]);
  // a failed install left no app behind, but is still worth telling; a failed update of a removed app is not
  expect(codes({ activity: [{ ts: NOW - 1000, code: "app.install.failed", app: "ghost" }] })).toEqual(["failed.install"]);
  expect(codes({ activity: [failed] })).toEqual([]);
});

test("parseStats computes what `docker stats` shows", () => {
  const stats = parseStats({
    cpu_stats: { cpu_usage: { total_usage: 2_000_000 }, system_cpu_usage: 20_000_000, online_cpus: 4 },
    precpu_stats: { cpu_usage: { total_usage: 1_000_000 }, system_cpu_usage: 10_000_000 },
    memory_stats: { usage: 500, limit: 4000, stats: { inactive_file: 100 } },
  });
  expect(stats).toEqual({ cpu: 40, memory: 400, memoryLimit: 4000 });
  // the first sample of a container has nothing to compare with
  expect(parseStats({ cpu_stats: { cpu_usage: { total_usage: 5 } }, precpu_stats: { cpu_usage: { total_usage: 0 } }, memory_stats: {} }).cpu).toBe(0);
});
