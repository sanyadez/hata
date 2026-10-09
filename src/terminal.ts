/**
 * Terminals in the web UI: a shell on the server, or one inside a container of an app.
 *
 * The shell is a child of the server on a pseudo-terminal (`Bun.spawn` with `terminal`). The browser is
 * only a window into it: the WebSocket may close and open again (the phone went to sleep, the page was
 * reloaded) while the shell lives on, and a new connection gets the tail of the output. One terminal per
 * key ("host", "app:<name>:<container>"); several connections may watch it — the output goes to all,
 * the size is the last one set.
 *
 * On the WebSocket binary messages are bytes (input from the browser, output from the server) and text
 * messages are JSON (`resize` from the browser; `ready`, `exit`, `error` from the server). Who may open
 * what is decided in `server.ts`; here are the processes. The spawner is passed in, so the manager is
 * tested without a pseudo-terminal.
 */

/** How much of the latest output a new connection is given */
export const MAX_REPLAY_BYTES = 256 * 1024;
export const MAX_TERMINALS = 8;
/** A terminal nobody has been connected to for this long is closed */
export const TERMINAL_IDLE_MS = 12 * 3600_000;
/** A browser this far behind the output is cut off rather than buffered for without end */
export const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
/** How long a shell has to leave after SIGHUP before it is killed */
const KILL_GRACE_MS = 2000;
/** The last output may come a little after the process itself has gone */
const EXIT_FLUSH_MS = 40;

/** WebSocket close code for a browser that does not keep up: the page connects again */
export const WS_SLOW_CLIENT = 4001;

export type TerminalErrorKind = "unsupported" | "limit" | "spawn";

export class TerminalError extends Error {
  constructor(
    readonly kind: TerminalErrorKind,
    message: string = kind,
  ) {
    super(message);
  }
}

/** A browser's connection (a ServerWebSocket; a stand-in in tests) */
export interface TerminalClient {
  send(data: string | Uint8Array): unknown;
  close(code?: number, reason?: string): void;
  getBufferedAmount?(): number;
}

export interface PtyHandle {
  pid: number;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  kill(signal: "SIGHUP" | "SIGKILL"): void;
  /** Closes the pseudo-terminal (after the process has gone) */
  close(): void;
  exited: Promise<number>;
}

export interface PtySpawnOptions {
  cmd: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  onData(chunk: Uint8Array): void;
}

export type SpawnPty = (opts: PtySpawnOptions) => PtyHandle;

/** What to run for a terminal that does not exist yet */
export interface TerminalStart {
  cmd: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface TerminalInfo {
  key: string;
  pid: number;
  startedAt: number;
  clients: number;
  cols: number;
  rows: number;
}

interface Term {
  key: string;
  pty: PtyHandle;
  startedAt: number;
  cols: number;
  rows: number;
  clients: Set<TerminalClient>;
  /** The tail of the output for a new connection */
  chunks: Uint8Array[];
  bytes: number;
  idle: ReturnType<typeof setTimeout> | null;
  exited: boolean;
}

export function ptySupported(): boolean {
  return process.platform !== "win32" && typeof (Bun as unknown as { Terminal?: unknown }).Terminal === "function";
}

/**
 * The shell of the server's user: `$SHELL`, else bash, else sh — as a login shell, because a service
 * has a bare PATH and a terminal is expected to be what ssh gives.
 */
export function shellCommand(env: Record<string, string | undefined> = process.env, which: (cmd: string) => string | null = Bun.which): string[] {
  for (const candidate of [env.SHELL, "bash", "sh"]) {
    const path = candidate ? which(candidate) : null;
    if (path) return [path, "-l"];
  }
  return ["/bin/sh", "-l"];
}

/** A shell inside a running container: bash where the image has it, sh otherwise */
export function containerCommand(container: string): string[] {
  return ["docker", "exec", "-it", "-e", "TERM=xterm-256color", container, "sh", "-c", "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi"];
}

/** The server's environment plus what a terminal needs for colours and UTF-8 */
export function terminalEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined) out[key] = value;
  out.TERM = "xterm-256color";
  out.COLORTERM = "truecolor";
  // The browser's terminal is always UTF-8, a service has the C locale or none: `ls` would show names in
  // other alphabets as codes. Only the character set changes; messages and sorting stay as they were.
  if (!/utf-?8/i.test(out.LC_ALL || out.LC_CTYPE || out.LANG || "")) out[out.LC_ALL ? "LC_ALL" : "LC_CTYPE"] = "C.UTF-8";
  return out;
}

/** The size asked for, within reason; nonsense becomes 80×24 */
export function clampSize(cols: unknown, rows: unknown): { cols: number; rows: number } {
  const num = (value: unknown, min: number, max: number, fallback: number) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n >= min ? Math.min(n, max) : fallback;
  };
  return { cols: num(cols, 2, 500, 80), rows: num(rows, 1, 300, 24) };
}

export const bunPty: SpawnPty = (opts) => {
  const proc = Bun.spawn(opts.cmd, {
    cwd: opts.cwd,
    env: opts.env,
    terminal: {
      cols: opts.cols,
      rows: opts.rows,
      // Bun may use the buffer again: keep a copy
      data: (_terminal: unknown, chunk: Uint8Array) => opts.onData(chunk.slice()),
    },
  } as Parameters<typeof Bun.spawn>[1]);
  const term = (proc as unknown as { terminal: { write(data: string | Uint8Array): void; resize(cols: number, rows: number): void; close(): void } }).terminal;
  return {
    pid: proc.pid,
    write: (data) => void term.write(data),
    resize: (cols, rows) => term.resize(cols, rows),
    kill: (signal) => proc.kill(signal),
    close: () => {
      try {
        term.close();
      } catch {
        // closed already
      }
    },
    exited: proc.exited,
  };
};

export interface TerminalDeps {
  spawn?: SpawnPty;
  /** A terminal appeared or went away */
  onChange?: () => void;
  idleMs?: number;
  max?: number;
}

export class TerminalManager {
  private readonly terms = new Map<string, Term>();
  private readonly byClient = new Map<TerminalClient, Term>();

  constructor(private readonly deps: TerminalDeps = {}) {}

  supported(): boolean {
    return this.deps.spawn !== undefined || ptySupported();
  }

  list(): TerminalInfo[] {
    return [...this.terms.values()].map((term) => this.info(term));
  }

  has(key: string): boolean {
    return this.terms.has(key);
  }

  /**
   * Connects a browser to the terminal of `key`; when there is none, `start` says what to run.
   * Returns whether a new one was started.
   */
  attach(client: TerminalClient, key: string, cols: unknown, rows: unknown, start: () => TerminalStart): boolean {
    const size = clampSize(cols, rows);
    let term = this.terms.get(key);
    const created = !term;
    if (!term) term = this.start(key, size.cols, size.rows, start());
    else if (term.cols !== size.cols || term.rows !== size.rows) this.applySize(term, size.cols, size.rows);
    if (term.idle) {
      clearTimeout(term.idle);
      term.idle = null;
    }
    term.clients.add(client);
    this.byClient.set(client, term);
    client.send(JSON.stringify({ type: "ready", created, ...this.info(term) }));
    if (term.bytes) client.send(joinChunks(term.chunks, term.bytes));
    return created;
  }

  input(client: TerminalClient, data: string | Uint8Array): void {
    const term = this.byClient.get(client);
    if (!term || term.exited) return;
    try {
      term.pty.write(data);
    } catch {
      // the process has just gone
    }
  }

  resize(client: TerminalClient, cols: unknown, rows: unknown): void {
    const term = this.byClient.get(client);
    if (!term || term.exited) return;
    const size = clampSize(cols, rows);
    if (term.cols !== size.cols || term.rows !== size.rows) this.applySize(term, size.cols, size.rows);
  }

  /** The browser went away: the shell lives on */
  detach(client: TerminalClient): void {
    const term = this.byClient.get(client);
    if (!term) return;
    this.byClient.delete(client);
    term.clients.delete(client);
    if (!term.clients.size && !term.exited) this.armIdle(term);
  }

  /** Closes a terminal; false when there is none with this key */
  kill(key: string): boolean {
    const term = this.terms.get(key);
    if (!term) return false;
    this.hangup(term);
    return true;
  }

  closeAll(): void {
    for (const term of [...this.terms.values()]) this.hangup(term);
  }

  private info(term: Term): TerminalInfo {
    return { key: term.key, pid: term.pty.pid, startedAt: term.startedAt, clients: term.clients.size, cols: term.cols, rows: term.rows };
  }

  private start(key: string, cols: number, rows: number, what: TerminalStart): Term {
    if (!this.supported()) throw new TerminalError("unsupported");
    if (this.terms.size >= (this.deps.max ?? MAX_TERMINALS)) throw new TerminalError("limit");
    const term: Term = { key, pty: null as unknown as PtyHandle, startedAt: Date.now(), cols, rows, clients: new Set(), chunks: [], bytes: 0, idle: null, exited: false };
    try {
      term.pty = (this.deps.spawn ?? bunPty)({ ...what, cols, rows, onData: (chunk) => this.output(term, chunk) });
    } catch (e) {
      throw new TerminalError("spawn", e instanceof Error ? e.message : String(e));
    }
    this.terms.set(key, term);
    term.pty.exited.then(
      (code) => this.finished(term, code),
      () => this.finished(term, -1),
    );
    this.deps.onChange?.();
    return term;
  }

  private applySize(term: Term, cols: number, rows: number): void {
    term.cols = cols;
    term.rows = rows;
    try {
      term.pty.resize(cols, rows);
    } catch {
      // the process has just gone
    }
  }

  private output(term: Term, chunk: Uint8Array): void {
    if (!chunk.length) return;
    term.chunks.push(chunk);
    term.bytes += chunk.length;
    while (term.chunks.length > 1 && term.bytes - term.chunks[0]!.length >= MAX_REPLAY_BYTES) term.bytes -= term.chunks.shift()!.length;
    for (const client of [...term.clients]) {
      if ((client.getBufferedAmount?.() ?? 0) > MAX_BUFFERED_BYTES) {
        // `yes`, or `cat` of a big file over a slow link: the page gets the tail when it connects again
        this.detach(client);
        try {
          client.close(WS_SLOW_CLIENT, "slow");
        } catch {
          // closed already
        }
        continue;
      }
      try {
        client.send(chunk);
      } catch {
        // the connection is closing
      }
    }
  }

  private armIdle(term: Term): void {
    if (term.idle) clearTimeout(term.idle);
    term.idle = setTimeout(() => this.hangup(term), this.deps.idleMs ?? TERMINAL_IDLE_MS);
    term.idle.unref?.();
  }

  /** SIGHUP to the shell (which passes it on to its jobs); SIGKILL if that was not enough */
  private hangup(term: Term): void {
    if (term.exited) return;
    try {
      term.pty.kill("SIGHUP");
    } catch {
      // gone already
    }
    const timer = setTimeout(() => {
      if (term.exited) return;
      try {
        term.pty.kill("SIGKILL");
      } catch {
        // gone already
      }
    }, KILL_GRACE_MS);
    timer.unref?.();
  }

  private finished(term: Term, code: number): void {
    if (term.exited) return;
    term.exited = true;
    if (term.idle) {
      clearTimeout(term.idle);
      term.idle = null;
    }
    if (this.terms.get(term.key) === term) this.terms.delete(term.key);
    this.deps.onChange?.();
    setTimeout(() => {
      term.pty.close();
      const note = JSON.stringify({ type: "exit", code });
      for (const client of [...term.clients]) {
        this.byClient.delete(client);
        try {
          client.send(note);
          client.close(1000, "exit");
        } catch {
          // closed already
        }
      }
      term.clients.clear();
    }, EXIT_FLUSH_MS);
  }
}

function joinChunks(chunks: Uint8Array[], bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
