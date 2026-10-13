/**
 * The MCP server: Hata driven by an AI agent instead of a person at the web UI.
 *
 * The transport is Streamable HTTP in its plainest form: `POST /mcp` carries one JSON-RPC message and
 * the answer is JSON. No stream is offered, so `GET /mcp` is 405, as the specification asks.
 *
 * This file is the protocol only and has no side effects; who is asking (`agents.ts`) and what the
 * tools do (`mcptools.ts`) are decided elsewhere. A tool names the level a key needs for it, and a
 * caller is shown — and may call — only the tools of its level.
 */
import { allows, type Level } from "./agents";
import { answerOf, type Word } from "./approvals";

/** Who is calling: an access key, as far as the tools need to know it */
export interface Caller {
  name: string;
  level: Level;
  /** The name operations are written into the activity log under */
  user: string;
  /** A call that may destroy something waits for an administrator's word */
  confirm?: boolean;
}

/** An error the model sees as the result of its call (and can correct), not a failure of the protocol */
export class ToolError extends Error {}

export interface Tool {
  name: string;
  /** A short name for people: clients show it when they ask whether to run the tool */
  title: string;
  description: string;
  level: Level;
  /**
   * read — changes nothing; change — changes something that can be put back (start, stop, install);
   * destroy — may lose data or break a working app. Clients decide by it whether to ask the person first.
   */
  effect: "read" | "change" | "destroy";
  /** The arguments, as the `properties` of a JSON schema */
  input?: Record<string, Record<string, unknown>>;
  required?: string[];
  /** A string result goes as it is, anything else as JSON */
  run: (args: Record<string, unknown>, caller: Caller) => unknown | Promise<unknown>;
}

export interface ServerInfo {
  version: string;
  /** Told to the model when it connects */
  instructions?: (caller: Caller) => string;
  /** Asks an administrator about a destroying call of a caller that must ask; without it nothing is asked */
  approve?: (tool: Tool, args: Record<string, unknown>, caller: Caller) => Promise<Word>;
}

const PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
const LATEST_PROTOCOL = "2025-11-25";

type Id = string | number | null;
const result = (id: Id, value: unknown) => ({ jsonrpc: "2.0", id, result: value });
const error = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

/** The tools a caller of this level has */
export const toolsFor = (tools: Tool[], level: Level): Tool[] => tools.filter((tool) => allows(level, tool.level));

/** A tool as `tools/list` describes it */
export function describeTool(tool: Tool): Record<string, unknown> {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: { type: "object", properties: tool.input ?? {}, ...(tool.required?.length ? { required: tool.required } : {}), additionalProperties: false },
    annotations: { title: tool.title, readOnlyHint: tool.effect === "read", destructiveHint: tool.effect === "destroy", openWorldHint: false },
  };
}

/** Answers one JSON-RPC message; null for a notification, which gets no answer */
export async function handleMessage(message: unknown, tools: Tool[], caller: Caller, info: ServerInfo): Promise<object | null> {
  if (!message || typeof message !== "object" || Array.isArray(message)) return error(null, -32600, "Invalid Request");
  const m = message as { id?: Id; method?: unknown; params?: unknown };
  // a notification (`notifications/initialized`, `cancelled`), or the client's answer to a request we never make
  if (typeof m.method !== "string" || m.id === undefined) return null;
  const id = m.id;
  const params = m.params && typeof m.params === "object" && !Array.isArray(m.params) ? (m.params as Record<string, unknown>) : {};
  const mine = toolsFor(tools, caller.level);

  switch (m.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const instructions = info.instructions?.(caller) ?? "";
      return result(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : LATEST_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "hata", title: "Hata", version: info.version },
        ...(instructions ? { instructions } : {}),
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, { tools: mine.map(describeTool) });
    case "tools/call": {
      const tool = mine.find((t) => t.name === params.name);
      if (!tool) {
        // a tool of a higher level is said to be out of reach, so that the model stops trying and tells the person
        const beyond = tools.find((t) => t.name === params.name);
        return beyond
          ? result(id, { content: [{ type: "text", text: `The access key "${caller.name}" has the level "${caller.level}"; ${beyond.name} needs "${beyond.level}". An administrator of Hata makes keys in Settings → Agents.` }], isError: true })
          : error(id, -32602, `Unknown tool: ${String(params.name)}`);
      }
      const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? (params.arguments as Record<string, unknown>) : {};
      if (tool.effect === "destroy" && caller.confirm && info.approve) {
        const word = await info.approve(tool, args, caller);
        if (word !== "allowed") return result(id, { content: [{ type: "text", text: answerOf(word, tool.name) }], isError: word === "denied" });
      }
      try {
        const out = await tool.run(args, caller);
        return result(id, { content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 1) }] });
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e);
        if (!(e instanceof ToolError)) console.error(`MCP ${tool.name}:`, e);
        return result(id, { content: [{ type: "text", text }], isError: true });
      }
    }
  }
  return error(id, -32601, `Method not found: ${m.method}`);
}

const reply = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** The HTTP side of `POST /mcp`; the caller has been recognised by whoever calls this */
export async function mcpResponse(req: Request, tools: Tool[], caller: Caller, info: ServerInfo): Promise<Response> {
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply(error(null, -32700, "Parse error"), 400);
  }
  // batches left the protocol in 2025-06-18, but an older client may still send one
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleMessage(m, tools, caller, info)))).filter(Boolean);
    return out.length ? reply(out) : new Response(null, { status: 202 });
  }
  const out = await handleMessage(body, tools, caller, info);
  return out ? reply(out) : new Response(null, { status: 202 });
}
