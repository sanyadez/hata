import { expect, test } from "bun:test";
import { allows, createKey, keyOf, listKeys, removeKey, renameKey } from "../src/agents";
import { parseCompose } from "../src/appform";
import { describeTool, handleMessage, ToolError, toolsFor, type Caller, type Tool } from "../src/mcp";
import { findings, happened, HIDDEN, instructions, maskCompose, TOOLS, type ContainerState } from "../src/mcptools";

const caller = (level: Caller["level"]): Caller => ({ name: "laptop", level, user: "agent:laptop" });
const info = { version: "1.2.3", instructions: () => "hello" };
const call = (message: unknown, level: Caller["level"], tools: Tool[] = SAMPLE) => handleMessage(message, tools, caller(level), info) as Promise<any>;

const SAMPLE: Tool[] = [
  { name: "look", title: "Look", description: "", level: "read", effect: "read", run: () => ({ seen: true }) },
  { name: "echo", title: "Echo", description: "", level: "read", effect: "read", input: { text: { type: "string" } }, required: ["text"], run: (args, who) => `${who.user}: ${args.text}` },
  { name: "push", title: "Push", description: "", level: "operate", effect: "change", run: () => "pushed" },
  { name: "burn", title: "Burn", description: "", level: "full", effect: "destroy", run: () => "burnt" },
  { name: "fail", title: "Fail", description: "", level: "read", effect: "read", run: () => { throw new ToolError("no such thing"); } },
];

test("a level includes the ones below it", () => {
  expect(allows("read", "read")).toBe(true);
  expect(allows("read", "operate")).toBe(false);
  expect(allows("operate", "read")).toBe(true);
  expect(allows("operate", "full")).toBe(false);
  expect(allows("full", "operate")).toBe(true);
});

test("initialize answers with a version the client knows, or the latest", async () => {
  const known = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, "read");
  expect(known.result.protocolVersion).toBe("2025-03-26");
  expect(known.result.serverInfo).toEqual({ name: "hata", title: "Hata", version: "1.2.3" });
  expect(known.result.instructions).toBe("hello");
  expect(known.result.capabilities.tools).toBeDefined();
  const unknown = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } }, "read");
  expect(unknown.result.protocolVersion).toBe("2025-11-25");
});

test("notifications get no answer, unknown methods an error", async () => {
  expect(await call({ jsonrpc: "2.0", method: "notifications/initialized" }, "read")).toBeNull();
  expect((await call({ jsonrpc: "2.0", id: 2, method: "resources/list" }, "read")).error.code).toBe(-32601);
  expect((await call("nonsense", "read")).error.code).toBe(-32600);
  expect((await call({ jsonrpc: "2.0", id: 3, method: "ping" }, "read")).result).toEqual({});
});

test("a caller is shown only the tools of its level", async () => {
  const names = async (level: Caller["level"]) => (await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, level)).result.tools.map((t: { name: string }) => t.name);
  expect(await names("read")).toEqual(["look", "echo", "fail"]);
  expect(await names("operate")).toEqual(["look", "echo", "push", "fail"]);
  expect(await names("full")).toEqual(["look", "echo", "push", "burn", "fail"]);
});

test("a tool is described with a schema and what it does to the world", () => {
  expect(describeTool(SAMPLE[1]!)).toEqual({
    name: "echo",
    title: "Echo",
    description: "",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
    annotations: { title: "Echo", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  });
  expect((describeTool(SAMPLE[3]!).annotations as any).destructiveHint).toBe(true);
  expect((describeTool(SAMPLE[2]!).annotations as any).readOnlyHint).toBe(false);
});

test("calling a tool: the result, an error of the tool, a tool out of reach", async () => {
  const run = (name: string, level: Caller["level"], args?: unknown) => call({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } }, level);
  expect((await run("look", "read")).result.content[0].text).toBe('{\n "seen": true\n}');
  expect((await run("echo", "read", { text: "hi" })).result.content[0].text).toBe("agent:laptop: hi");

  const failed = await run("fail", "read");
  expect(failed.result.isError).toBe(true);
  expect(failed.result.content[0].text).toBe("no such thing");

  // a tool above the key's level is not run, and the model is told why
  const refused = await run("burn", "operate");
  expect(refused.result.isError).toBe(true);
  expect(refused.result.content[0].text).toContain('needs "full"');
  expect((await run("burn", "full")).result.content[0].text).toBe("burnt");
  expect((await run("nothing", "full")).error.code).toBe(-32602);
});

test("the real tools: unique names, every level present, nothing that reaches users, files or a shell", () => {
  const names = TOOLS.map((t) => t.name);
  expect(new Set(names).size).toBe(names.length);
  for (const name of names) expect(name).toMatch(/^[a-z][a-z_]*$/);
  expect(names.filter((n) => /user|password|file|terminal|shell|exec|key|setting|session/.test(n))).toEqual([]);
  // looking never needs more than the lowest level, and nothing that only looks is marked as changing
  for (const tool of TOOLS) expect(tool.effect === "read").toBe(tool.level === "read");
  expect(toolsFor(TOOLS, "read").map((t) => t.name)).toEqual(["overview", "activity", "apps_list", "app_get", "app_logs", "app_diagnose", "app_compose", "store_search", "store_app", "backups", "disks", "job_get", "machines", "machine_apps", "machine_containers", "machine_app_logs", "machine_app_compose"]);
  expect(toolsFor(TOOLS, "operate").filter((t) => t.level === "operate").map((t) => t.name)).toEqual(["app_start", "app_stop", "app_restart", "app_update", "app_install", "backup_take", "machine_app_start", "machine_app_stop", "machine_app_restart", "machine_app_update", "machine_app_install", "machine_backup_take", "machine_wake"]);
  expect(TOOLS.filter((t) => t.level === "full").map((t) => t.name)).toEqual(["app_compose_set", "app_install_compose", "app_remove", "backup_restore", "machine_app_compose_set", "machine_app_remove", "machine_backup_restore", "app_move", "machine_power"]);
  expect(TOOLS.filter((t) => t.effect === "destroy").map((t) => t.name)).toEqual(["app_compose_set", "app_remove", "backup_restore", "machine_app_compose_set", "machine_app_remove", "machine_backup_restore", "app_move", "machine_power"]);
  expect(instructions(caller("read"))).toContain('level "read"');
});

test("secrets of a compose file are hidden from a reader", () => {
  const compose = parseCompose(`
name: demo
services:
  app:
    image: demo/app:1
    environment:
      TZ: Europe/Kyiv
      PUID: \${PUID}
      DB_PASSWORD: s3cret
      API_TOKEN: \${API_TOKEN}
      EMPTY_SECRET: ""
      DATABASE_URL: postgres://demo:hunter2@db:5432/demo
      PORT: 8080
    command: serve --admin-password=letmein --port 80
    x-casaos:
      envs: []
  db:
    image: postgres:16
    environment:
      - POSTGRES_PASSWORD=hunter2
      - POSTGRES_USER=demo
      - JUST_A_FLAG
    command: ["postgres", "--secret-key", "abc", "--token=xyz", "-c", "max_connections=50"]
x-casaos:
  title: { en_US: Demo }
`);
  const masked = maskCompose(compose);
  expect(masked.services.app.environment).toEqual({
    TZ: "Europe/Kyiv",
    PUID: "${PUID}",
    DB_PASSWORD: HIDDEN,
    // a reference to a variable gives nothing away
    API_TOKEN: "${API_TOKEN}",
    EMPTY_SECRET: "",
    DATABASE_URL: `postgres://demo:${HIDDEN}@db:5432/demo`,
    PORT: 8080,
  });
  expect(masked.services.app.command).toBe(`serve --admin-password=${HIDDEN} --port 80`);
  expect(masked.services.db.environment).toEqual([`POSTGRES_PASSWORD=${HIDDEN}`, "POSTGRES_USER=demo", "JUST_A_FLAG"]);
  expect(masked.services.db.command).toEqual(["postgres", "--secret-key", HIDDEN, `--token=${HIDDEN}`, "-c", "max_connections=50"]);
  expect(masked["x-casaos"]).toBeUndefined();
  expect(masked.services.app["x-casaos"]).toBeUndefined();
  expect(JSON.stringify(masked)).not.toMatch(/s3cret|hunter2|letmein|abc|xyz/);
  // the file itself is not touched
  expect(compose.services.app.environment.DB_PASSWORD).toBe("s3cret");
  expect(compose["x-casaos"]).toBeDefined();
});

test("what the state of the containers and the log say about the trouble", () => {
  const c = (over: Partial<ContainerState>): ContainerState => ({ name: "demo-app-1", state: "running", exitCode: 0, oom: false, restarts: 0, error: "", health: "", ...over });
  expect(findings({ containers: [c({})], log: "listening on :8080" })).toEqual([]);
  expect(findings({ containers: [], log: "" })[0]).toContain("no containers");
  expect(findings({ containers: [c({})], log: "", docker: false })).toEqual(["Docker is not available on this server: no app can run until it is."]);

  const oom = findings({ containers: [c({ state: "exited", exitCode: 137, oom: true })], log: "" });
  expect(oom).toHaveLength(1);
  expect(oom[0]).toContain("OOM");
  expect(findings({ containers: [c({ state: "exited", exitCode: 137 })], log: "" })[0]).toContain("exit code 137");
  expect(findings({ containers: [c({ state: "exited", exitCode: 127 })], log: "" })[0]).toContain("could not run its command");
  expect(findings({ containers: [c({ state: "exited", exitCode: 0 })], log: "" })[0]).toContain("finished by itself");
  expect(findings({ containers: [c({ health: "unhealthy" })], log: "" })[0]).toContain("health check");
  // stopped by somebody: neither "finished by itself" nor "was killed" is the story
  expect(findings({ containers: [c({ state: "exited", exitCode: 0 }), c({ name: "demo-db-1", state: "exited", exitCode: 137 })], log: "", stoppedBy: "admin" })).toEqual(["The app is not broken: it was stopped by admin and has not been started since."]);
  expect(findings({ containers: [c({ state: "restarting", exitCode: 1, restarts: 5 })], log: "", stoppedBy: "admin" })[0]).toContain("keeps restarting");

  const looping = findings({ containers: [c({ state: "restarting", exitCode: 1, restarts: 14 })], log: "Error: listen tcp 0.0.0.0:8080: bind: address already in use" });
  expect(looping[0]).toContain("keeps restarting (14 times");
  expect(looping[1]).toContain("port");
  expect(findings({ containers: [c({})], log: "mkdir /config: permission denied" })[0]).toContain("PUID/PGID");
  expect(findings({ containers: [c({})], log: "write /data/x: no space left on device", disks: [{ path: "/DATA", percent: 99 }, { path: "/", percent: 40 }] })).toEqual(["The disk is full: the app could not write.", "The disk at /DATA is 99% full."]);
  expect(findings({ containers: [c({})], log: "", memoryPercent: 95 })[0]).toContain("95%");
  expect(findings({ containers: [c({ state: "created", error: "driver failed programming external connectivity" })], log: "" })[0]).toContain("Docker could not start it");
});

test("access keys: shown once, found by the Bearer token, gone when removed", () => {
  const request = (token?: string) => new Request("http://hata/mcp", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });
  expect(createKey("", "read", "admin")).toBe("agents.badName");
  expect(createKey("x".repeat(41), "read", "admin")).toBe("agents.badName");
  expect(createKey("laptop", "root", "admin")).toBe("agents.badLevel");

  const made = createKey("  My   laptop ", "operate", "admin");
  if (typeof made === "string") throw new Error(made);
  expect(made.key).toMatch(/^hata_[A-Za-z0-9_-]{43}$/);
  expect(made.info).toMatchObject({ name: "My laptop", level: "operate", createdBy: "admin", lastUsed: 0, hint: made.key.slice(-4) });
  expect(createKey("my laptop", "read", "admin")).toBe("agents.nameTaken");
  // nothing that is kept or listed holds the key
  expect(JSON.stringify(listKeys())).not.toContain(made.key.slice(5));
  expect("hash" in listKeys()[0]!).toBe(false);

  expect(keyOf(request())).toBeNull();
  expect(keyOf(request("hata_" + "A".repeat(43)))).toBeNull();
  expect(keyOf(request(made.key.slice(5)))).toBeNull();
  const found = keyOf(request(made.key), "192.0.2.9");
  expect(found?.name).toBe("My laptop");
  expect(listKeys()[0]).toMatchObject({ lastIp: "192.0.2.9" });
  expect(listKeys()[0]!.lastUsed).toBeGreaterThan(0);

  // renamed: the same key goes on working under the new name
  const other = createKey("desktop", "read", "admin");
  if (typeof other === "string") throw new Error(other);
  expect(renameKey(made.info.id, "Desktop")).toBe("agents.nameTaken");
  expect(renameKey(made.info.id, " ")).toBe("agents.badName");
  expect(renameKey("no-such-id", "x")).toBe("agents.notFound");
  expect(renameKey(made.info.id, "  Work   laptop ")).toMatchObject({ was: "My laptop", key: { name: "Work laptop" } });
  expect(keyOf(request(made.key))?.name).toBe("Work laptop");
  removeKey(other.info.id);

  expect(removeKey("no-such-id")).toBeNull();
  expect(removeKey(made.info.id)?.name).toBe("Work laptop");
  expect(keyOf(request(made.key))).toBeNull();
  expect(listKeys()).toEqual([]);
});

test("happened: an entry of the activity log in words", () => {
  expect(happened({ code: "app.docker.done", app: "", user: "tester" })).toBe("Docker installed");
  expect(happened({ code: "system.disk.format", detail: "USB DISK → exFAT" })).toBe("Disk formatted: USB DISK → exFAT");
  expect(happened({ code: "app.install.done", app: "memos" })).toContain("memos");
  expect(happened({ code: "no.such.code" })).toBe("no.such.code");
});
