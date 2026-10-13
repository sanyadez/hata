/**
 * A person's word before an agent destroys something.
 *
 * A key can be made to ask: a call that may lose data (removing an app, restoring a snapshot, replacing
 * a compose file) is then not run until an administrator allows it in Hata — on the page, or from the
 * notification. The call waits for the word a short while; when none comes it answers that it waits,
 * and the same call repeated later finds the word that was given in between.
 *
 * - A word is for one call: the same tool with the same arguments from the same key, once.
 * - A request nobody answers lapses; a word given and not used lapses too.
 * - A refusal is remembered for a while, so that an agent that tries again does not ask again.
 * - Nothing is written to disk: a restart of Hata forgets what was asked.
 */

export interface Ask {
  id: string;
  /** The name of the access key that asks */
  agent: string;
  tool: string;
  /** The tool's name for people, in English — for a tool the page has no words of its own for */
  title: string;
  args: Record<string, unknown>;
  /** Tells one call from another: the tool and its arguments */
  print: string;
  at: number;
  state: "waiting" | "allowed" | "denied";
  by?: string;
  decidedAt?: number;
}

export type Word = "allowed" | "denied" | "waiting";

/** How long a call itself waits for the word: clients give up on a tool after a minute or so */
export const WAIT_MS = 25_000;
/** How long a request stays open, and how long a word that was given stays good */
export const ASK_MS = 10 * 60_000;
const MAX_WAITING = 20;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}

/** The same for the same call, whatever order its arguments came in */
export const printOf = (tool: string, args: Record<string, unknown>): string => new Bun.CryptoHasher("sha256").update(JSON.stringify([tool, canonical(args)])).digest("hex");

/** What is still worth keeping at `now` */
export const alive = (ask: Ask, now: number): boolean => now - (ask.state === "waiting" ? ask.at : (ask.decidedAt ?? ask.at)) < ASK_MS;

export class Desk {
  private asks: Ask[] = [];
  private waiters = new Map<string, (() => void)[]>();

  constructor(
    /** Told about a new request (to notify the administrators) and about every change (to refresh the pages) */
    private hooks: { asked?: (ask: Ask) => void; changed?: () => void } = {},
    private waitMs = WAIT_MS,
    private now: () => number = Date.now,
  ) {}

  private prune(): void {
    const now = this.now();
    this.asks = this.asks.filter((ask) => alive(ask, now));
  }

  private drop(ask: Ask): void {
    this.asks = this.asks.filter((a) => a !== ask);
  }

  /** The requests an administrator has not answered yet, oldest first */
  waiting(): Ask[] {
    this.prune();
    return this.asks.filter((ask) => ask.state === "waiting");
  }

  /**
   * Whether this call may run. "allowed" spends the word; "waiting" — nobody has answered yet (the
   * request stays open, the call is to be repeated); "denied" — an administrator said no.
   */
  async ask(agent: string, tool: { name: string; title: string }, args: Record<string, unknown>): Promise<Word> {
    this.prune();
    const print = printOf(tool.name, args);
    let ask = this.asks.find((a) => a.agent === agent && a.print === print);
    if (!ask) {
      // an agent that asks about everything at once is not let to bury the page
      if (this.asks.filter((a) => a.agent === agent && a.state === "waiting").length >= MAX_WAITING) return "waiting";
      ask = { id: crypto.randomUUID(), agent, tool: tool.name, title: tool.title, args, print, at: this.now(), state: "waiting" };
      this.asks.push(ask);
      this.hooks.changed?.();
      this.hooks.asked?.(ask);
    }
    if (ask.state === "waiting") {
      const id = ask.id;
      await Promise.race([new Promise<void>((done) => this.waiters.set(id, [...(this.waiters.get(id) ?? []), done])), Bun.sleep(this.waitMs)]);
    }
    if (ask.state === "allowed") this.drop(ask);
    return ask.state;
  }

  /** An administrator's word on a request; null — there is no such request any more */
  decide(id: string, allow: boolean, by: string): Ask | null {
    this.prune();
    const ask = this.asks.find((a) => a.id === id && a.state === "waiting");
    if (!ask) return null;
    ask.state = allow ? "allowed" : "denied";
    ask.by = by;
    ask.decidedAt = this.now();
    for (const done of this.waiters.get(id) ?? []) done();
    this.waiters.delete(id);
    this.hooks.changed?.();
    return ask;
  }

  /** A key that is removed takes its requests along */
  forget(agent: string): void {
    const before = this.asks.length;
    this.asks = this.asks.filter((a) => a.agent !== agent);
    if (this.asks.length !== before) this.hooks.changed?.();
  }
}

/** What the answer of a call says when it did not run */
export function answerOf(word: Exclude<Word, "allowed">, tool: string): string {
  return word === "denied"
    ? `An administrator of Hata declined this call of ${tool}. Do not try it again: tell the person it was declined.`
    : `Not run yet: ${tool} needs the word of an administrator of Hata for this access key, and nobody has answered so far. The administrators have been asked (a notification, and a dialog on Hata's pages). Tell the person to open Hata and allow it, then call ${tool} again with exactly the same arguments — a word given stays good for ten minutes.`;
}
