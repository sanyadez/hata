import { expect, test } from "bun:test";
import { advance, anthropicReply, anthropicRequest, changeConfig, clip, configured, DEFAULT_CONFIG, errorOf, MAX_STEPS, modelNames, openaiReply, openaiRequest, openCalls, shownChat, titleOf, type AssistantConfig, type Chat, type Engine, type Reply, type Turn } from "../src/assistant";
import { ToolError, type Tool } from "../src/mcp";

const tool = (name: string, effect: Tool["effect"], run: Tool["run"] = () => name + " done"): Tool => ({ name, title: name, description: "About " + name, level: "read", effect, input: { app: { type: "string" } }, required: ["app"], run });
const TOOLS = [tool("app_get", "read"), tool("app_restart", "change"), tool("app_remove", "destroy")];
const ANTHROPIC: AssistantConfig = { provider: "anthropic", url: "", key: "sk-test", model: "some-model", level: "full" };
const OPENAI: AssistantConfig = { provider: "openai", url: "http://localhost:11434/v1", key: "", model: "local", level: "full" };

test("the settings: an empty key keeps the saved one, a new provider does not inherit it", () => {
  const set = changeConfig(DEFAULT_CONFIG, { key: " sk-1 ", model: "m" }) as AssistantConfig;
  expect(set).toMatchObject({ provider: "anthropic", key: "sk-1", model: "m", level: "operate" });
  expect(changeConfig(set, { key: "", level: "read" })).toMatchObject({ key: "sk-1", level: "read" });
  expect(changeConfig(set, { forgetKey: true })).toMatchObject({ key: "" });
  expect(changeConfig(set, { provider: "openai", url: "http://localhost:11434/v1/" })).toMatchObject({ provider: "openai", key: "", url: "http://localhost:11434/v1" });
  expect(changeConfig(set, { url: "ftp://x" })).toBe("assistant.badUrl");
  expect(changeConfig(set, { model: "a b" })).toBe("assistant.bad");
  expect(changeConfig(set, { level: "god" })).toMatchObject({ level: "operate" });
  expect(configured(DEFAULT_CONFIG)).toBe(false);
  expect(configured(set)).toBe(true);
  // a server of one's own may need no key; the provider's own always does
  expect(configured(OPENAI)).toBe(true);
  expect(configured({ ...OPENAI, url: "" })).toBe(false);
});

const TURNS: Turn[] = [
  { role: "user", text: "Why is memos down?", at: 1 },
  { role: "assistant", text: "Looking.", calls: [{ id: "c1", name: "app_get", args: { app: "memos" } }, { id: "c2", name: "app_restart", args: { app: "memos" } }], at: 2 },
  { role: "tool", id: "c1", name: "app_get", text: "stopped" },
  { role: "tool", id: "c2", name: "app_restart", text: "no such app", error: true },
  { role: "assistant", text: "It is stopped.", calls: [], at: 3 },
];

test("a conversation worded for the Messages protocol", () => {
  const { url, headers, body } = anthropicRequest(ANTHROPIC, "SYSTEM", TURNS, TOOLS);
  expect(url).toBe("https://api.anthropic.com/v1/messages");
  expect(headers).toMatchObject({ "x-api-key": "sk-test", "anthropic-version": "2023-06-01" });
  expect(body).toMatchObject({ model: "some-model", system: "SYSTEM" });
  expect((body.tools as unknown[])[0]).toEqual({ name: "app_get", description: "About app_get", input_schema: { type: "object", properties: { app: { type: "string" } }, required: ["app"], additionalProperties: false } });
  expect(body.messages).toEqual([
    { role: "user", content: "Why is memos down?" },
    { role: "assistant", content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "c1", name: "app_get", input: { app: "memos" } }, { type: "tool_use", id: "c2", name: "app_restart", input: { app: "memos" } }] },
    // the results of one turn go back together
    { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "stopped" }, { type: "tool_result", tool_use_id: "c2", content: "no such app", is_error: true }] },
    { role: "assistant", content: [{ type: "text", text: "It is stopped." }] },
  ]);
});

test("what the provider said goes back to it as it came, and is retold for another one", () => {
  const raw = [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: "Hi" }];
  const turns: Turn[] = [{ role: "user", text: "Hi", at: 1 }, { role: "assistant", text: "Hi", calls: [], at: 2, raw, via: "anthropic" }];
  expect((anthropicRequest(ANTHROPIC, "", turns, []).body.messages as { content: unknown }[])[1]!.content).toBe(raw);
  expect((openaiRequest(OPENAI, "", turns, []).body.messages as unknown[])[2]).toEqual({ role: "assistant", content: "Hi" });
});

test("a conversation worded for the OpenAI protocol", () => {
  const { url, headers, body } = openaiRequest(OPENAI, "SYSTEM", TURNS, TOOLS);
  expect(url).toBe("http://localhost:11434/v1/chat/completions");
  expect(headers.authorization).toBeUndefined();
  expect(openaiRequest({ ...OPENAI, url: "", key: "k" }, "", [], []).headers.authorization).toBe("Bearer k");
  expect((body.tools as unknown[])[1]).toMatchObject({ type: "function", function: { name: "app_restart", parameters: { type: "object" } } });
  expect(body.messages).toEqual([
    { role: "system", content: "SYSTEM" },
    { role: "user", content: "Why is memos down?" },
    { role: "assistant", content: "Looking.", tool_calls: [{ id: "c1", type: "function", function: { name: "app_get", arguments: '{"app":"memos"}' } }, { id: "c2", type: "function", function: { name: "app_restart", arguments: '{"app":"memos"}' } }] },
    { role: "tool", tool_call_id: "c1", content: "stopped" },
    { role: "tool", tool_call_id: "c2", content: "no such app" },
    { role: "assistant", content: "It is stopped." },
  ]);
});

test("the answers of both protocols read into one shape", () => {
  const a = anthropicReply({ stop_reason: "tool_use", content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Let me look." }, { type: "tool_use", id: "toolu_1", name: "app_get", input: { app: "memos" } }] });
  expect(a).toMatchObject({ text: "Let me look.", calls: [{ id: "toolu_1", name: "app_get", args: { app: "memos" } }] });
  expect(a.stopped).toBeUndefined();
  expect((a.raw as unknown[]).length).toBe(3);
  expect(anthropicReply({ stop_reason: "refusal", content: [] }).stopped).toBe("refusal");
  expect(anthropicReply({ stop_reason: "max_tokens", content: [{ type: "text", text: "half" }] })).toMatchObject({ text: "half", stopped: "length" });

  const o = openaiReply({ choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, reasoning_content: "…", tool_calls: [{ id: "call_1", type: "function", function: { name: "app_get", arguments: '{"app":"memos"}' } }, { function: { name: "app_restart", arguments: "not json" } }] } }] });
  expect(o.text).toBe("");
  expect(o.calls[0]).toEqual({ id: "call_1", name: "app_get", args: { app: "memos" } });
  // a call without an id gets one, broken arguments become none
  expect(o.calls[1]).toMatchObject({ name: "app_restart", args: {} });
  expect(o.calls[1]!.id).toMatch(/^call_1_/);
  // only the protocol's own fields are sent back
  expect(Object.keys(o.raw as object)).toEqual(["role", "content", "tool_calls"]);
  expect(openaiReply({ choices: [{ finish_reason: "length", message: { content: " cut " } }] })).toMatchObject({ text: "cut", stopped: "length" });
  expect(openaiReply({})).toMatchObject({ text: "", calls: [] });
});

test("the lists of models and the refusals of the providers", () => {
  expect(modelNames({ data: [{ id: "a" }, { id: "b", display_name: "B" }, {}] })).toEqual(["a", "b"]);
  expect(modelNames({ models: [{ name: "llama3" }] })).toEqual(["llama3"]);
  expect(modelNames("x")).toEqual([]);
  expect(errorOf(401, '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}')).toMatchObject({ code: "key", message: "HTTP 401: invalid x-api-key" });
  expect(errorOf(429, '{"error":{"message":"slow down"}}').code).toBe("rate");
  expect(errorOf(404, '{"error":"model not found"}')).toMatchObject({ code: "model", message: "HTTP 404: model not found" });
  expect(errorOf(500, "<html>").code).toBe("refused");
});

test("a long output reaches the model cut, and says so", () => {
  expect(clip("short")).toBe("short");
  const cut = clip("x".repeat(50), 10);
  expect(cut.startsWith("x".repeat(10) + "\n… (cut here: 40 more characters")).toBe(true);
});

const newChat = (text: string): Chat => ({ id: "1", owner: "u", ownerName: "anna", title: titleOf(text), createdAt: 0, updatedAt: 0, turns: [{ role: "user", text, at: 0 }], status: "idle" });
const scripted = (replies: Partial<Reply>[], tools = TOOLS): Engine & { asked: Turn[][] } => {
  const asked: Turn[][] = [];
  return { asked, tools, caller: { name: "assistant", level: "full", user: "assistant:anna" }, ask: async (turns) => (asked.push(structuredClone(turns)), { text: "", calls: [], raw: null, via: "anthropic" as const, ...replies.shift()! }) };
};

test("what only looks runs at once; a change waits for the person", async () => {
  const ran: string[] = [];
  const tools = [tool("app_get", "read", () => (ran.push("get"), { status: "stopped" })), tool("app_restart", "change", (args) => (ran.push("restart " + args.app), "restarted"))];
  const engine = scripted([{ text: "Looking.", calls: [{ id: "c1", name: "app_get", args: { app: "memos" } }] }, { text: "It is stopped; I will restart it.", calls: [{ id: "c2", name: "app_restart", args: { app: "memos" } }] }, { text: "Done." }], tools);
  const chat = newChat("Why is memos down?");
  await advance(chat, engine);
  expect(chat.status).toBe("asking");
  expect(ran).toEqual(["get"]);
  expect(openCalls(chat.turns)).toEqual([{ id: "c2", name: "app_restart", args: { app: "memos" }, state: "asking" }]);
  // the result of the look went to the model as JSON
  expect(engine.asked[1]![2]).toEqual({ role: "tool", id: "c1", name: "app_get", text: '{\n "status": "stopped"\n}' });

  openCalls(chat.turns)[0]!.state = "run";
  await advance(chat, engine);
  expect(ran).toEqual(["get", "restart memos"]);
  expect(chat.status).toBe("idle");
  expect(chat.turns.map((t) => t.role)).toEqual(["user", "assistant", "tool", "assistant", "tool", "assistant"]);
  expect(chat.turns.at(-1)).toMatchObject({ text: "Done.", calls: [] });
  expect(openCalls(chat.turns)).toEqual([]);
});

test("a declined change is told to the model and never runs; several wait together", async () => {
  const ran: string[] = [];
  const tools = [tool("app_get", "read", () => (ran.push("get"), "ok")), tool("app_restart", "change", () => (ran.push("restart"), "ok")), tool("app_remove", "destroy", () => (ran.push("remove"), "ok"))];
  const engine = scripted([{ calls: [{ id: "a", name: "app_restart", args: {} }, { id: "b", name: "app_get", args: {} }, { id: "c", name: "app_remove", args: {} }] }, { text: "As you wish." }], tools);
  const chat = newChat("Clean up");
  await advance(chat, engine);
  // the look in the middle ran, the two changes wait
  expect(ran).toEqual(["get"]);
  expect(openCalls(chat.turns).map((c) => [c.id, c.state])).toEqual([["a", "asking"], ["c", "asking"]]);
  openCalls(chat.turns)[0]!.state = "run";
  openCalls(chat.turns)[1]!.state = "declined";
  await advance(chat, engine);
  expect(ran).toEqual(["get", "restart"]);
  const declined = chat.turns.find((t) => t.role === "tool" && t.id === "c");
  expect(declined).toMatchObject({ error: true, declined: true });
  expect(chat.status).toBe("idle");
  // every call of the turn has its result before the model is asked again
  expect(engine.asked[1]!.filter((t) => t.role === "tool").map((t) => (t as { id: string }).id).sort()).toEqual(["a", "b", "c"]);
});

test("a tool that fails or does not exist is an answer to the model, not the end of the chat", async () => {
  const tools = [tool("app_get", "read", () => { throw new ToolError("no such app"); })];
  const engine = scripted([{ calls: [{ id: "a", name: "app_get", args: {} }, { id: "b", name: "made_up", args: {} }] }, { text: "Sorry." }], tools);
  const chat = newChat("?");
  await advance(chat, engine);
  expect(chat.turns.filter((t) => t.role === "tool")).toEqual([{ role: "tool", id: "a", name: "app_get", text: "no such app", error: true }, { role: "tool", id: "b", name: "made_up", text: "There is no tool named made_up.", error: true }]);
  expect(chat.status).toBe("idle");
});

test("a provider's refusal, an answer cut short, an empty one, a loop without end", async () => {
  const failing: Engine = { tools: TOOLS, caller: { name: "assistant", level: "full", user: "assistant:anna" }, ask: async () => { throw errorOf(401, '{"error":{"message":"bad key"}}'); } };
  const chat = newChat("Hi");
  await advance(chat, failing);
  expect(chat).toMatchObject({ status: "error", error: { code: "key", message: "HTTP 401: bad key" } });

  const cut = newChat("Hi");
  await advance(cut, scripted([{ text: "half", stopped: "length", calls: [{ id: "x", name: "app_remove", args: {} }], raw: [{ type: "text", text: "half" }] }]));
  // the call that came with a cut answer is not run or asked about, and the turn is kept in our words
  expect(cut.turns.at(-1)).toEqual({ role: "assistant", text: "half\n\n(The answer was cut short at the length limit.)", calls: [], at: expect.any(Number) });
  expect(cut.status).toBe("idle");

  const empty = newChat("Hi");
  await advance(empty, scripted([{}]));
  expect(empty.turns.at(-1)).toMatchObject({ text: "(The model gave an empty answer.)" });
  expect("raw" in empty.turns.at(-1)!).toBe(false);

  const endless = newChat("Hi");
  let n = 0;
  await advance(endless, { tools: TOOLS, caller: failing.caller, ask: async () => ({ text: "", calls: [{ id: "c" + n++, name: "app_get", args: {} }], raw: null }) });
  expect(n).toBe(MAX_STEPS);
  expect(endless.status).toBe("error");
});

test("stopped by the person: no error, and a change that waited still waits", async () => {
  const abort = new AbortController();
  const chat = newChat("Hi");
  await advance(chat, { tools: TOOLS, caller: { name: "assistant", level: "full", user: "x" }, ask: async () => { abort.abort(new Error("stopped")); throw new Error("aborted"); } }, abort.signal);
  expect(chat.status).toBe("idle");
  expect(chat.error).toBeUndefined();
});

test("the page gets a chat without what only the provider needs", () => {
  const chat: Chat = { ...newChat("Hi"), turns: [{ role: "user", text: "Hi", at: 1 }, { role: "assistant", text: "Yo", calls: [], at: 2, raw: [{ secret: 1 }], via: "anthropic" }, { role: "tool", id: "a", name: "t", text: "x".repeat(9000) }] };
  const shown = shownChat(chat);
  expect(JSON.stringify(shown)).not.toContain("secret");
  expect("owner" in shown).toBe(false);
  expect((shown.turns[2] as { text: string }).text.length).toBe(4000);
});
