/**
 * The assistant: a chat on Hata's own pages that answers "why is Jellyfin down" and acts — with the
 * same tools an outside agent gets over MCP (`mcptools.ts`), and with every change shown to the person
 * before it runs.
 *
 * Hata has no model of its own. An administrator names one, reached by either of the two protocols
 * model providers speak: Messages (`anthropic`) or chat completions (`openai` — which a server on
 * one's own machine speaks too). The conversation is kept in a form
 * of our own (`Turn`) and worded for the provider at each request; what the provider answered is kept
 * as it came and sent back untouched, because a model may refuse a history that was edited.
 *
 * The loop (`advance`): ask the model; run what only looks (`effect: "read"`) at once; stop at the
 * first call that changes something and wait for the person's "Run" or "Decline"; give the results
 * back; repeat until the model has nothing more to call.
 *
 * What the model reads — logs, the state of the apps, compose files at the level set — leaves this
 * machine for the provider. The settings page says so.
 */
import { join } from "node:path";
import { LEVELS, type Level } from "./agents";
import { bus } from "./bus";
import { SECRETS_DIR } from "./config";
import { isPlainObject, readJsonFile, writeJsonAtomic } from "./fsutil";
import { describeTool, ToolError, toolsFor, type Caller, type Tool } from "./mcp";

// --- Settings ---------------------------------------------------------------------------------------

export const PROVIDERS = ["anthropic", "openai"] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface AssistantConfig {
  provider: Provider;
  /** The address of the API; "" — the provider's own */
  url: string;
  key: string;
  model: string;
  /** What the assistant may reach, as for an access key */
  level: Level;
}

export const DEFAULT_URL: Record<Provider, string> = { anthropic: "https://api.anthropic.com", openai: "https://api.openai.com/v1" };
export const DEFAULT_CONFIG: AssistantConfig = { provider: "anthropic", url: "", key: "", model: "", level: "operate" };

const httpUrl = (value: string): boolean => {
  try {
    return /^https?:$/.test(new URL(value).protocol) && value.length <= 2048;
  } catch {
    return false;
  }
};

/** Applies a change to the settings; the settings, or the code of what is wrong. An empty key keeps the saved one. */
export function changeConfig(current: AssistantConfig, patch: unknown): AssistantConfig | string {
  if (!isPlainObject(patch)) return "assistant.bad";
  const text = (value: unknown, fallback: string) => (typeof value === "string" ? value.trim() : fallback);
  const next: AssistantConfig = {
    provider: PROVIDERS.includes(patch.provider as Provider) ? (patch.provider as Provider) : current.provider,
    url: text(patch.url, current.url).replace(/\/+$/, ""),
    key: text(patch.key, "") || (patch.forgetKey === true ? "" : current.key),
    model: text(patch.model, current.model),
    level: LEVELS.includes(patch.level as Level) ? (patch.level as Level) : current.level,
  };
  // a key made for one provider is not sent to another
  if (next.provider !== current.provider && !text(patch.key, "")) next.key = "";
  if (next.url && !httpUrl(next.url)) return "assistant.badUrl";
  if (/[\r\n]/.test(next.key) || next.key.length > 500 || next.model.length > 200 || /\s/.test(next.model)) return "assistant.bad";
  return next;
}

/** Whether there is enough to ask a model: a provider needs a key, a server of one's own may need none */
export const configured = (config: AssistantConfig): boolean => config.model !== "" && (config.key !== "" || (config.provider === "openai" && config.url !== ""));

// --- The conversation -------------------------------------------------------------------------------

export interface Call {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** asking — waits for the person; run / declined — the person's answer, until the tool has run */
  state?: "asking" | "run" | "declined";
}

export type Turn =
  | { role: "user"; text: string; at: number }
  | { role: "assistant"; text: string; calls: Call[]; at: number; /** the provider's own message and whose it is */ raw?: unknown; via?: Provider }
  | { role: "tool"; id: string; name: string; text: string; error?: boolean; /** not run: the person said no */ declined?: boolean };

/** What a model answered, whichever protocol it came by */
export interface Reply {
  text: string;
  calls: Call[];
  raw: unknown;
  /** Why it stopped when not for a usual reason: cut short, or declined by the provider */
  stopped?: "length" | "refusal";
}

export interface Outgoing {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Room for an answer; a longer one arrives cut and says so */
const MAX_TOKENS = 16000;

const toolResultText = (turn: Extract<Turn, { role: "tool" }>): string => turn.text || "(no output)";

/** The request in the Messages protocol */
export function anthropicRequest(config: AssistantConfig, system: string, turns: Turn[], tools: Tool[]): Outgoing {
  const messages: { role: string; content: unknown }[] = [];
  for (const turn of turns) {
    if (turn.role === "user") messages.push({ role: "user", content: turn.text });
    else if (turn.role === "assistant") {
      // its own blocks go back as they came; a turn made by another provider is retold
      const retold = [...(turn.text ? [{ type: "text", text: turn.text }] : []), ...turn.calls.map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: call.args }))];
      messages.push({ role: "assistant", content: turn.via === "anthropic" && Array.isArray(turn.raw) ? turn.raw : retold });
    } else {
      // the results of one turn's calls travel together, in a single message
      const block = { type: "tool_result", tool_use_id: turn.id, content: toolResultText(turn), ...(turn.error ? { is_error: true } : {}) };
      const last = messages[messages.length - 1];
      if (last?.role === "user" && Array.isArray(last.content) && (last.content as { type?: string }[])[0]?.type === "tool_result") (last.content as unknown[]).push(block);
      else messages.push({ role: "user", content: [block] });
    }
  }
  return {
    url: `${config.url || DEFAULT_URL.anthropic}/v1/messages`,
    headers: { "content-type": "application/json", "x-api-key": config.key, "anthropic-version": "2023-06-01" },
    body: {
      model: config.model,
      max_tokens: MAX_TOKENS,
      // the part that repeats from request to request is read from the provider's cache
      cache_control: { type: "ephemeral" },
      system,
      tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: describeTool(tool).inputSchema })),
      messages,
    },
  };
}

const record = (value: unknown): Record<string, unknown> => (isPlainObject(value) ? value : {});

export function anthropicReply(data: unknown): Reply {
  const body = record(data);
  const blocks = Array.isArray(body.content) ? (body.content as Record<string, unknown>[]) : [];
  return {
    text: blocks.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text as string).join("\n\n").trim(),
    calls: blocks.filter((b) => b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string").map((b) => ({ id: b.id as string, name: b.name as string, args: record(b.input) })),
    raw: blocks,
    ...(body.stop_reason === "max_tokens" ? { stopped: "length" as const } : body.stop_reason === "refusal" ? { stopped: "refusal" as const } : {}),
  };
}

/** The request to a server that speaks the OpenAI chat protocol */
export function openaiRequest(config: AssistantConfig, system: string, turns: Turn[], tools: Tool[]): Outgoing {
  const messages: Record<string, unknown>[] = [{ role: "system", content: system }];
  for (const turn of turns) {
    if (turn.role === "user") messages.push({ role: "user", content: turn.text });
    else if (turn.role === "assistant") {
      const retold = { role: "assistant", content: turn.text || null, ...(turn.calls.length ? { tool_calls: turn.calls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } })) } : {}) };
      messages.push(turn.via === "openai" && isPlainObject(turn.raw) ? turn.raw : retold);
    } else messages.push({ role: "tool", tool_call_id: turn.id, content: toolResultText(turn) });
  }
  return {
    url: `${config.url || DEFAULT_URL.openai}/chat/completions`,
    headers: { "content-type": "application/json", ...(config.key ? { authorization: `Bearer ${config.key}` } : {}) },
    body: { model: config.model, messages, tools: tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: describeTool(tool).inputSchema } })) },
  };
}

export function openaiReply(data: unknown): Reply {
  const choice = record((Array.isArray(record(data).choices) ? (record(data).choices as unknown[]) : [])[0]);
  const message = record(choice.message);
  const calls: Call[] = [];
  for (const item of Array.isArray(message.tool_calls) ? (message.tool_calls as Record<string, unknown>[]) : []) {
    const fn = record(item.function);
    if (typeof fn.name !== "string") continue;
    let args: unknown = fn.arguments;
    // the arguments come as JSON in a string; a server of one's own may send an object
    if (typeof args === "string") {
      try {
        args = JSON.parse(args || "{}");
      } catch {
        args = {};
      }
    }
    calls.push({ id: typeof item.id === "string" && item.id ? item.id : `call_${calls.length}_${crypto.randomUUID().slice(0, 8)}`, name: fn.name, args: record(args) });
  }
  const text = typeof message.content === "string" ? message.content.trim() : "";
  return {
    text,
    calls,
    // only what the protocol names goes back: servers add fields of their own that others refuse
    raw: { role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } })) } : {}) },
    ...(choice.finish_reason === "length" ? { stopped: "length" as const } : choice.finish_reason === "content_filter" ? { stopped: "refusal" as const } : {}),
  };
}

/** The names of the models a provider's answer lists, for the field to choose from */
export function modelNames(data: unknown): string[] {
  const list = Array.isArray(record(data).data) ? (record(data).data as unknown[]) : Array.isArray(record(data).models) ? (record(data).models as unknown[]) : [];
  return list.map((item) => record(item).id ?? record(item).name).filter((id): id is string => typeof id === "string" && id !== "").slice(0, 300);
}

/** Why a provider refused, as a code the page words; `message` is the provider's own word */
export class ModelError extends Error {
  constructor(
    public code: "key" | "rate" | "unreachable" | "model" | "refused",
    message = "",
  ) {
    super(message || code);
  }
}

export function errorOf(status: number, body: string): ModelError {
  let said = body.slice(0, 300);
  try {
    const parsed = record(JSON.parse(body));
    const error = parsed.error;
    said = String((isPlainObject(error) ? error.message : error) ?? parsed.message ?? said).slice(0, 300);
  } catch {}
  return new ModelError(status === 401 || status === 403 ? "key" : status === 429 ? "rate" : status === 404 ? "model" : "refused", `HTTP ${status}${said ? ": " + said : ""}`);
}

const REQUEST_TIMEOUT_MS = 5 * 60_000;

async function send(request: Outgoing, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ModelError("unreachable", e instanceof Error ? e.message : String(e));
  }
  const text = await res.text();
  if (!res.ok) throw errorOf(res.status, text);
  try {
    return JSON.parse(text);
  } catch {
    throw new ModelError("refused", "The answer is not JSON — is the address that of the API?");
  }
}

/** One question to the model named in the settings */
export async function askModel(config: AssistantConfig, system: string, turns: Turn[], tools: Tool[], signal?: AbortSignal): Promise<Reply & { via: Provider }> {
  const reply = config.provider === "anthropic" ? anthropicReply(await send(anthropicRequest(config, system, turns, tools), signal)) : openaiReply(await send(openaiRequest(config, system, turns, tools), signal));
  return { ...reply, via: config.provider };
}

/** The models the provider offers to this key */
export async function listModels(config: AssistantConfig): Promise<string[]> {
  const anthropic = config.provider === "anthropic";
  const url = anthropic ? `${config.url || DEFAULT_URL.anthropic}/v1/models?limit=100` : `${config.url || DEFAULT_URL.openai}/models`;
  let res: Response;
  try {
    res = await fetch(url, { headers: anthropic ? { "x-api-key": config.key, "anthropic-version": "2023-06-01" } : config.key ? { authorization: `Bearer ${config.key}` } : {}, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new ModelError("unreachable", e instanceof Error ? e.message : String(e));
  }
  const text = await res.text();
  if (!res.ok) throw errorOf(res.status, text);
  try {
    return modelNames(JSON.parse(text));
  } catch {
    throw new ModelError("refused", "The answer is not JSON — is the address that of the API?");
  }
}

// --- The loop ---------------------------------------------------------------------------------------

export interface Chat {
  id: string;
  /** Whose it is (user id) and the name its doings are logged under */
  owner: string;
  ownerName: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: Turn[];
  /** thinking — the model or a tool is at work; asking — a change waits for the person */
  status: "idle" | "thinking" | "asking" | "error";
  error?: { code: string; message: string };
}

/** How many times the model is asked for one message of the person: a loop that does not end is stopped */
export const MAX_STEPS = 24;
/** A tool's output longer than this reaches the model cut, and is told so */
export const MAX_RESULT = 30_000;

export function clip(text: string, max = MAX_RESULT): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (cut here: ${text.length - max} more characters were not passed on; ask for a narrower slice if they matter)`;
}

/** The calls of the last answer that have no result yet */
export function openCalls(turns: Turn[]): Call[] {
  let at = turns.length - 1;
  while (at >= 0 && turns[at]!.role === "tool") at--;
  const last = turns[at];
  if (!last || last.role !== "assistant") return [];
  const answered = new Set(turns.slice(at + 1).map((turn) => (turn.role === "tool" ? turn.id : "")));
  return last.calls.filter((call) => !answered.has(call.id));
}

export interface Engine {
  ask: (turns: Turn[], signal?: AbortSignal) => Promise<Reply & { via?: Provider }>;
  tools: Tool[];
  caller: Caller;
  /** Told after every step, so that the page can follow */
  changed?: (chat: Chat) => void;
}

async function runCall(call: Call, engine: Engine): Promise<Extract<Turn, { role: "tool" }>> {
  const tool = engine.tools.find((t) => t.name === call.name);
  if (!tool) return { role: "tool", id: call.id, name: call.name, text: `There is no tool named ${call.name}.`, error: true };
  try {
    const out = await tool.run(call.args, engine.caller);
    return { role: "tool", id: call.id, name: call.name, text: clip(typeof out === "string" ? out : JSON.stringify(out, null, 1)) };
  } catch (e) {
    if (!(e instanceof ToolError)) console.error(`Assistant, ${call.name}:`, e);
    return { role: "tool", id: call.id, name: call.name, text: e instanceof Error ? e.message : String(e), error: true };
  }
}

/**
 * Moves a chat on as far as it goes without the person: until the model has answered in words, or a
 * call that changes something waits for "Run" / "Decline" (`status: "asking"`).
 */
export async function advance(chat: Chat, engine: Engine, signal?: AbortSignal): Promise<void> {
  const step = () => {
    chat.updatedAt = Date.now();
    engine.changed?.(chat);
  };
  chat.status = "thinking";
  delete chat.error;
  step();
  try {
    for (let steps = 0; ; ) {
      const open = openCalls(chat.turns);
      if (open.length) {
        // in the order the model gave: what only looks runs at once, a change waits for its answer
        for (const call of open) {
          const tool = engine.tools.find((t) => t.name === call.name);
          if (tool && tool.effect !== "read" && call.state !== "run" && call.state !== "declined") {
            call.state = "asking";
            continue;
          }
          const result: Extract<Turn, { role: "tool" }> = call.state === "declined" ? { role: "tool", id: call.id, name: call.name, text: "The person declined this action. Do not try it again unless they ask.", error: true, declined: true } : await runCall(call, engine);
          delete call.state;
          chat.turns.push(result);
          step();
          if (signal?.aborted) throw signal.reason;
        }
        if (openCalls(chat.turns).length) {
          chat.status = "asking";
          return step();
        }
        continue;
      }
      const last = chat.turns[chat.turns.length - 1];
      if (!last || last.role === "assistant") break;
      if (++steps > MAX_STEPS) throw new ModelError("refused", "Too many steps for one question: stopped. Say “continue” to go on.");
      const reply = await engine.ask(chat.turns, signal);
      const note = reply.stopped === "refusal" ? "(The model declined to answer this.)" : reply.stopped === "length" ? "(The answer was cut short at the length limit.)" : "";
      // a call cut off by the limit is not a call to run
      const calls = reply.stopped ? [] : reply.calls;
      // an answer with nothing in it cannot be sent back as it came: it is kept in words of ours
      const empty = !reply.text && !calls.length;
      chat.turns.push({ role: "assistant", text: [reply.text, note].filter(Boolean).join("\n\n") || (empty ? "(The model gave an empty answer.)" : ""), calls, at: Date.now(), ...(reply.stopped || empty ? {} : { raw: reply.raw, via: reply.via }) });
      step();
    }
    chat.status = "idle";
  } catch (e) {
    if (signal?.aborted) chat.status = openCalls(chat.turns).length ? "asking" : "idle";
    else {
      chat.status = "error";
      chat.error = { code: e instanceof ModelError ? e.code : "refused", message: e instanceof Error ? e.message : String(e) };
    }
  }
  step();
}

/** A chat as the page gets it: without what only the provider needs back */
export const shownChat = ({ turns, owner: _, ...chat }: Chat) => ({ ...chat, turns: turns.map((turn) => (turn.role === "assistant" ? { role: turn.role, text: turn.text, calls: turn.calls, at: turn.at } : turn.role === "tool" ? { ...turn, text: turn.text.slice(0, 4000) } : turn)) });

/** The first words of a chat, for the list */
/** The first words of a chat, as its name; a long one is cut at a word and says so */
export function titleOf(text: string): string {
  const words = text.replace(/\s+/g, " ").trim();
  if (words.length <= 60) return words || "…";
  const cut = words.slice(0, 60);
  return (cut.lastIndexOf(" ") > 30 ? cut.slice(0, cut.lastIndexOf(" ")) : cut).replace(/[\s,.;:!?–—-]+$/, "") + "…";
}

/** What the model is told about where it is and how to behave */
export function systemPrompt(base: string, user: string, origin = ""): string {
  return [
    base,
    `You are the assistant built into Hata's web UI, talking with ${user}, an administrator of this server. Answer in the language the person writes in, briefly and in plain words: say what you found and what you suggest, not how you looked.`,
    "Tools that only look run at once. A tool that changes something is shown to the person with “Run” and “Decline” buttons before it runs — so do not ask for permission in words first: say in a sentence what you are about to do and why, and call the tool. If it comes back declined, do not repeat it.",
    ...(origin ? [`The person has Hata open at ${origin}. An app's page is on the same host at the app's own port (or at the address the app's tile has): give whole addresses with that host, never a placeholder for it.`] : []),
    "When you do not know, look with a tool instead of guessing. What you cannot do with the tools (users, files, a shell, Hata's own settings), the person does in the web UI — name the page.",
  ].join("\n");
}

// --- State ------------------------------------------------------------------------------------------

const CONFIG_FILE = join(SECRETS_DIR, "assistant.json");
const CHATS_FILE = join(SECRETS_DIR, "assistant-chats.json");
const KEEP_CHATS = 30;
const MAX_MESSAGE = 20_000;

let config: AssistantConfig = (() => {
  const read = changeConfig(DEFAULT_CONFIG, readJsonFile<unknown>(CONFIG_FILE, {}, isPlainObject));
  return typeof read === "string" ? { ...DEFAULT_CONFIG } : read;
})();
// what was under way when the server stopped is not picked up again: the person asks anew
let chats: Chat[] = readJsonFile<Chat[]>(CHATS_FILE, [], Array.isArray)
  .filter((chat) => isPlainObject(chat) && Array.isArray(chat.turns))
  .map((chat) => ({ ...chat, status: chat.status === "thinking" ? "idle" : chat.status }));
const running = new Map<string, AbortController>();

let saving: Timer | null = null;
function saveChats(): void {
  if (saving) return;
  saving = setTimeout(() => {
    saving = null;
    try {
      writeJsonAtomic(CHATS_FILE, chats);
    } catch (e) {
      console.error("Could not write the assistant's chats:", e instanceof Error ? e.message : e);
    }
  }, 500);
}

export const assistantConfig = (): AssistantConfig => config;
/** The settings as the page gets them: the key is write-only */
export const shownConfig = () => ({ ...config, key: "", saved: config.key !== "", ready: configured(config), defaults: DEFAULT_URL });

export function updateAssistant(patch: unknown): string | null {
  const next = changeConfig(config, patch);
  if (typeof next === "string") return next;
  config = next;
  writeJsonAtomic(CONFIG_FILE, config);
  return null;
}

/** The models for the settings being typed: what is not filled in yet is taken from what is saved */
export function modelsFor(patch: unknown): Promise<string[]> {
  const draft = changeConfig(config, patch);
  if (typeof draft === "string") throw new ModelError("refused", draft);
  return listModels(draft);
}

export const listChats = (owner: string) => chats.filter((chat) => chat.owner === owner).sort((a, b) => b.updatedAt - a.updatedAt).map(({ id, title, updatedAt, status }) => ({ id, title, updatedAt, status }));
export const findChat = (owner: string, id: string): Chat | undefined => chats.find((chat) => chat.id === id && chat.owner === owner);

/** What the server gives the assistant to work with */
export interface Host {
  tools: Tool[];
  instructions: (caller: Caller) => string;
  /** Where the person has Hata open, `http://192.168.1.10` */
  origin?: string;
}

function go(chat: Chat, host: Host): void {
  const caller: Caller = { name: "assistant", level: config.level, user: `${ASSISTANT_PREFIX}${chat.ownerName}`, ...(host.origin ? { origin: host.origin } : {}) };
  const tools = toolsFor(host.tools, config.level);
  const system = systemPrompt(host.instructions(caller), chat.ownerName, host.origin);
  const settings = config;
  const abort = new AbortController();
  running.set(chat.id, abort);
  void advance(
    chat,
    {
      tools,
      caller,
      ask: (turns, signal) => askModel(settings, system, turns, tools, signal),
      changed: () => {
        saveChats();
        bus.publish("assistant", { chat: chat.id, owner: chat.owner });
      },
    },
    abort.signal,
  ).finally(() => {
    if (running.get(chat.id) === abort) running.delete(chat.id);
  });
}

/** The person says something: in a chat of theirs, or a new one. A string is an error code. */
export function say(owner: { id: string; name: string }, chatId: string | null, text: unknown, host: Host): Chat | string {
  if (!configured(config)) return "assistant.notSet";
  const words = typeof text === "string" ? text.trim() : "";
  if (!words || words.length > MAX_MESSAGE) return "assistant.badMessage";
  let chat = chatId ? findChat(owner.id, chatId) : undefined;
  if (chatId && !chat) return "assistant.noChat";
  if (chat && (chat.status === "thinking" || chat.status === "asking")) return "assistant.busy";
  if (!chat) {
    chat = { id: crypto.randomUUID(), owner: owner.id, ownerName: owner.name, title: titleOf(words), createdAt: Date.now(), updatedAt: Date.now(), turns: [], status: "idle" };
    chats.push(chat);
    // the oldest chats of this person give way
    const mine = chats.filter((c) => c.owner === owner.id).sort((a, b) => b.updatedAt - a.updatedAt);
    const drop = new Set(mine.slice(KEEP_CHATS).map((c) => c.id));
    chats = chats.filter((c) => !drop.has(c.id));
  }
  chat.ownerName = owner.name;
  chat.turns.push({ role: "user", text: words, at: Date.now() });
  go(chat, host);
  return chat;
}

/** "Try again" after the provider failed: the same question, asked once more */
export function retry(owner: string, chatId: string, host: Host): Chat | string {
  const chat = findChat(owner, chatId);
  if (!chat) return "assistant.noChat";
  if (chat.status !== "error" || running.has(chat.id)) return "assistant.busy";
  go(chat, host);
  return chat;
}

/** The person's answer to a change the assistant wants to make */
export function answerCall(owner: string, chatId: string, callId: string, run: boolean, host: Host): Chat | string {
  const chat = findChat(owner, chatId);
  if (!chat) return "assistant.noChat";
  const call = openCalls(chat.turns).find((c) => c.id === callId && c.state === "asking");
  if (!call || running.has(chat.id)) return "assistant.noCall";
  call.state = run ? "run" : "declined";
  // the model is answered once every change of its turn has the person's word
  if (openCalls(chat.turns).some((c) => c.state === "asking")) {
    saveChats();
    bus.publish("assistant", { chat: chat.id, owner: chat.owner });
  } else go(chat, host);
  return chat;
}

/** "Stop": the request under way is dropped; a tool that already runs finishes by itself */
export function stopChat(owner: string, chatId: string): boolean {
  const chat = findChat(owner, chatId);
  if (!chat) return false;
  running.get(chat.id)?.abort(new Error("stopped"));
  return true;
}

export function removeChat(owner: string, chatId: string): boolean {
  if (!stopChat(owner, chatId)) return false;
  chats = chats.filter((chat) => !(chat.id === chatId && chat.owner === owner));
  saveChats();
  return true;
}

/** How the assistant is named where a person's name would stand (the activity log): after whom it worked for */
export const ASSISTANT_PREFIX = "assistant:";
