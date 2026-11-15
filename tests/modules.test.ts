import { expect, test } from "bun:test";
import { cleanModules, missingFor, MODULE_IDS, moduleOfPath, moduleOfTool, MODULES, neededBy, needsOf, switchesFor } from "../src/modules";
import { TOOLS } from "../src/mcptools";

test("requests are told apart: a module's own and the base's", () => {
  expect(moduleOfPath("/api/disks")).toBeNull();
  expect(moduleOfPath("/api/disks/sda/format")).toBeNull();
  expect(moduleOfPath("/api/disks/array")).toBe("raid");
  expect(moduleOfPath("/api/disks/array/sync")).toBe("raid");
  expect(moduleOfPath("/api/disks/raid/check")).toBe("raid");
  expect(moduleOfPath("/api/disks/plan")).toBe("raid");
  expect(moduleOfPath("/api/backups")).toBeNull();
  expect(moduleOfPath("/api/backups/memos/take")).toBeNull();
  expect(moduleOfPath("/api/backups/offsite")).toBe("offsite");
  expect(moduleOfPath("/api/backups/offsite/check")).toBe("offsite");
  expect(moduleOfPath("/api/dns")).toBe("dns");
  expect(moduleOfPath("/api/dns/records")).toBe("dns");
  expect(moduleOfPath("/api/dns/block")).toBe("adblock");
  expect(moduleOfPath("/api/dns/block/lists")).toBe("adblock");
  expect(moduleOfPath("/api/https/wildcard")).toBeNull();
  expect(moduleOfPath("/api/machines/0a1b2c3d/files")).toBe("machines");
  expect(moduleOfPath("/client/link")).toBe("machines");
  expect(moduleOfPath("/mcp")).toBe("assistant");
  expect(moduleOfPath("/.well-known/oauth-authorization-server")).toBe("assistant");
  expect(moduleOfPath("/api/apps")).toBeNull();
  expect(moduleOfPath("/api/modules")).toBeNull();
  expect(moduleOfPath("/api/servers")).toBeNull();
});

test("every tool is the base's or one module's, and the base keeps what it had", () => {
  const base = TOOLS.filter((tool) => !moduleOfTool(tool.name)).map((tool) => tool.name).sort();
  expect(base).toEqual(["activity", "app_compose", "app_compose_set", "app_diagnose", "app_get", "app_install", "app_install_compose", "app_logs", "app_remove", "app_restart", "app_start", "app_stop", "app_update", "apps_list", "backup_restore", "backup_take", "backups", "disks", "docker_space", "https_state", "job_get", "network", "overview", "store_app", "store_search", "system_update", "system_updates", "system_updates_check"]);
  for (const spec of MODULES) {
    if (!spec.tools) continue;
    expect(TOOLS.some((tool) => spec.tools!.test(tool.name))).toBe(true);
  }
  expect(moduleOfTool("machine_app_install")).toBe("machines");
  expect(moduleOfTool("app_move")).toBe("machines");
  expect(moduleOfTool("container")).toBe("containers");
  expect(moduleOfTool("dns_queries")).toBe("adblock");
  expect(moduleOfTool("dns_record_add")).toBe("dns");
  expect(moduleOfTool("home_assistant_control")).toBe("integrations");
  expect(moduleOfTool("port_set")).toBe("domains");
});

test("a settings file is made whole", () => {
  const on = cleanModules({ dns: true, adblock: "yes", made: true });
  expect(Object.keys(on)).toEqual([...MODULE_IDS]);
  expect(on.dns).toBe(true);
  expect(on.adblock).toBe(false);
  expect(Object.values(cleanModules(null)).some(Boolean)).toBe(false);
});

test("what a module stands on goes on with it and holds it on", () => {
  expect(needsOf("adblock")).toEqual(["dns"]);
  const off = cleanModules({});
  expect(missingFor("adblock", off)).toEqual(["dns"]);
  expect(missingFor("adblock", cleanModules({ dns: true }))).toEqual([]);
  expect(neededBy("dns", cleanModules({ dns: true, adblock: true }))).toEqual(["adblock"]);
  expect(neededBy("dns", cleanModules({ dns: true }))).toEqual([]);
  // every need names a module that exists, and nothing needs itself
  for (const spec of MODULES) for (const need of spec.needs) expect(MODULE_IDS.includes(need) && need !== spec.id).toBe(true);
});

test("an older server keeps what it uses", () => {
  const on = switchesFor(["adblock", "machines"]);
  expect(MODULE_IDS.filter((id) => on[id])).toEqual(["dns", "adblock", "machines"]);
});
