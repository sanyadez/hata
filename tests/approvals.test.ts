import { expect, test } from "bun:test";
import { answerOf, ASK_MS, Desk, printOf } from "../src/approvals";
import { handleMessage, type Tool } from "../src/mcp";
import { askMessage } from "../src/notify";

const REMOVE = { name: "app_remove", title: "Remove an app" };

test("a call is the tool and its arguments, in whatever order they come", () => {
  expect(printOf("app_remove", { app: "memos", deleteData: true })).toBe(printOf("app_remove", { deleteData: true, app: "memos" }));
  expect(printOf("app_remove", { app: "memos" })).not.toBe(printOf("app_remove", { app: "memos", deleteData: true }));
  expect(printOf("app_remove", { app: "memos" })).not.toBe(printOf("backup_restore", { app: "memos" }));
});

test("a call waits for the word and runs once it is given", async () => {
  const asked: string[] = [];
  const desk = new Desk({ asked: (ask) => asked.push(ask.id) }, 1000);
  const call = desk.ask("laptop", REMOVE, { app: "memos" });
  expect(desk.waiting().map((a) => a.tool)).toEqual(["app_remove"]);
  expect(desk.decide(asked[0]!, true, "anna")?.by).toBe("anna");
  expect(await call).toBe("allowed");
  // the word is spent: the same call asks anew
  expect(desk.waiting()).toEqual([]);
  expect(await new Desk({}, 5).ask("laptop", REMOVE, { app: "memos" })).toBe("waiting");
});

test("a word given after the call stopped waiting is found by the same call repeated — once", async () => {
  const desk = new Desk({}, 5);
  expect(await desk.ask("laptop", REMOVE, { app: "memos" })).toBe("waiting");
  // repeated while it waits: still one request
  expect(await desk.ask("laptop", REMOVE, { app: "memos" })).toBe("waiting");
  expect(desk.waiting().length).toBe(1);
  desk.decide(desk.waiting()[0]!.id, true, "anna");
  // another call, another key: not what was allowed
  expect(await desk.ask("laptop", REMOVE, { app: "memos", deleteData: true })).toBe("waiting");
  expect(await desk.ask("other", REMOVE, { app: "memos" })).toBe("waiting");
  expect(await desk.ask("laptop", REMOVE, { app: "memos" })).toBe("allowed");
  expect(await desk.ask("laptop", REMOVE, { app: "memos" })).toBe("waiting");
});

test("a refusal is remembered, a request and a word lapse", async () => {
  let now = 1_000_000;
  const desk = new Desk({}, 5, () => now);
  await desk.ask("laptop", REMOVE, { app: "memos" });
  const { id } = desk.waiting()[0]!;
  desk.decide(id, false, "anna");
  expect(await desk.ask("laptop", REMOVE, { app: "memos" })).toBe("denied");
  expect(desk.waiting()).toEqual([]);
  expect(desk.decide(id, true, "anna")).toBeNull();
  now += ASK_MS;
  expect(await desk.ask("laptop", REMOVE, { app: "memos" })).toBe("waiting");
  // nobody answered in time: the request is gone, and so is a word that was not used
  now += ASK_MS;
  expect(desk.waiting()).toEqual([]);
  await desk.ask("laptop", REMOVE, { app: "memos" });
  desk.decide(desk.waiting()[0]!.id, true, "anna");
  now += ASK_MS;
  expect(await desk.ask("laptop", REMOVE, { app: "memos" })).toBe("waiting");
});

test("a removed key takes its requests along", async () => {
  const desk = new Desk({}, 5);
  await desk.ask("laptop", REMOVE, { app: "memos" });
  desk.forget("laptop");
  expect(desk.waiting()).toEqual([]);
});

test("only a destroying call of a key that asks waits for the word", async () => {
  const ran: string[] = [];
  const tool = (name: string, effect: Tool["effect"]): Tool => ({ name, title: name, description: "", level: "full", effect, run: () => (ran.push(name), "done") });
  const tools = [tool("app_remove", "destroy"), tool("app_install_compose", "change")];
  const words: string[] = [];
  const info = { version: "1", approve: async () => (words.push("asked"), "waiting" as const) };
  const call = (name: string, confirm: boolean) => handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }, tools, { name: "laptop", level: "full", user: "agent:laptop", confirm }, info) as Promise<{ result: { content: { text: string }[]; isError?: boolean } }>;

  expect((await call("app_remove", false)).result.content[0]!.text).toBe("done");
  expect((await call("app_install_compose", true)).result.content[0]!.text).toBe("done");
  expect(words).toEqual([]);
  const held = await call("app_remove", true);
  expect(held.result.content[0]!.text).toBe(answerOf("waiting", "app_remove"));
  expect(held.result.isError).toBe(false);
  expect(ran).toEqual(["app_remove", "app_install_compose"]);

  info.approve = async () => "denied" as never;
  expect((await call("app_remove", true)).result.isError).toBe(true);
  info.approve = async () => "allowed" as never;
  expect((await call("app_remove", true)).result.content[0]!.text).toBe("done");
});

test("the notification says what is asked, in the device's language", () => {
  const ask = { id: "7", agent: "laptop", tool: "app_remove", title: "Remove an app", args: { app: "memos", deleteData: true } };
  expect(askMessage(ask, "en")).toMatchObject({ title: "The agent “laptop” asks for your word", text: "It wants to remove the app “memos” together with its data.", ask: "7", route: "#/settings/agents" });
  expect(askMessage(ask, "uk").text).toBe("Він хоче видалити застосунок «memos» разом із даними.");
  // a tool the pages have no words for is named by its title
  expect(askMessage({ ...ask, tool: "new_tool", title: "Burn it" }, "en").text).toBe("It wants to Burn it.");
});
