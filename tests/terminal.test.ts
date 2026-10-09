import { expect, test } from "bun:test";
import { clampSize, containerCommand, MAX_BUFFERED_BYTES, MAX_REPLAY_BYTES, ptySupported, shellCommand, TerminalError, TerminalManager, terminalEnv, WS_SLOW_CLIENT, type PtyHandle, type PtySpawnOptions, type TerminalClient } from "../src/terminal";

/** A stand-in for the browser's connection: keeps everything the server sent */
class FakeClient implements TerminalClient {
  texts: Record<string, unknown>[] = [];
  bytes: Uint8Array[] = [];
  closed: { code?: number; reason?: string } | null = null;
  buffered = 0;
  send(data: string | Uint8Array): void {
    if (typeof data === "string") this.texts.push(JSON.parse(data));
    else this.bytes.push(data);
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }
  getBufferedAmount(): number {
    return this.buffered;
  }
  get output(): string {
    return Buffer.concat(this.bytes).toString("utf8");
  }
  of(type: string) {
    return this.texts.find((text) => text.type === type);
  }
}

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(15);
  }
}

/** A stand-in pseudo-terminal: remembers what was written; output and exit are made by hand */
function fakePty() {
  const spawned: (PtySpawnOptions & { written: (string | Uint8Array)[]; sizes: [number, number][]; signals: string[]; exit(code: number): void })[] = [];
  const spawn = (opts: PtySpawnOptions): PtyHandle => {
    let exit!: (code: number) => void;
    const exited = new Promise<number>((resolve) => (exit = resolve));
    const written: (string | Uint8Array)[] = [];
    const sizes: [number, number][] = [];
    const signals: string[] = [];
    spawned.push({ ...opts, written, sizes, signals, exit });
    return {
      pid: 1000 + spawned.length,
      write: (data) => void written.push(data),
      resize: (cols, rows) => void sizes.push([cols, rows]),
      kill: (signal) => {
        signals.push(signal);
        if (signal === "SIGHUP") exit(129);
      },
      close: () => {},
      exited,
    };
  };
  return { spawn, spawned };
}

const start = () => ({ cmd: ["sh"], cwd: "/", env: {} });
const bytes = (text: string) => new TextEncoder().encode(text);

test("the shell is $SHELL, else bash, else sh — a login shell", () => {
  const which = (have: string[]) => (cmd: string) => (have.includes(cmd) ? "/bin/" + cmd.split("/").pop() : null);
  expect(shellCommand({ SHELL: "/usr/bin/zsh" }, which(["/usr/bin/zsh", "bash"]))).toEqual(["/bin/zsh", "-l"]);
  expect(shellCommand({ SHELL: "/nope" }, which(["bash", "sh"]))).toEqual(["/bin/bash", "-l"]);
  expect(shellCommand({}, which(["sh"]))).toEqual(["/bin/sh", "-l"]);
  expect(shellCommand({}, which([]))).toEqual(["/bin/sh", "-l"]);
});

test("a container's shell is asked of docker, by the container's id", () => {
  const cmd = containerCommand("abc123");
  expect(cmd.slice(0, 3)).toEqual(["docker", "exec", "-it"]);
  expect(cmd).toContain("abc123");
});

test("the environment gets colours and UTF-8 without changing a locale that already has it", () => {
  expect(terminalEnv({ PATH: "/bin", GONE: undefined })).toEqual({ PATH: "/bin", TERM: "xterm-256color", COLORTERM: "truecolor", LC_CTYPE: "C.UTF-8" });
  expect(terminalEnv({ LANG: "uk_UA.UTF-8" }).LC_CTYPE).toBeUndefined();
  expect(terminalEnv({ LC_ALL: "C" }).LC_ALL).toBe("C.UTF-8");
});

test("sizes are kept within reason", () => {
  expect(clampSize(120, 40)).toEqual({ cols: 120, rows: 40 });
  expect(clampSize("abc", null)).toEqual({ cols: 80, rows: 24 });
  expect(clampSize(100000, 100000)).toEqual({ cols: 500, rows: 300 });
  expect(clampSize(0, -1)).toEqual({ cols: 80, rows: 24 });
});

test("the first connection starts the shell, the second one joins it and gets the tail", async () => {
  const { spawn, spawned } = fakePty();
  const manager = new TerminalManager({ spawn });
  const a = new FakeClient();
  expect(manager.attach(a, "host", 100, 30, start)).toBe(true);
  expect(spawned).toHaveLength(1);
  expect(spawned[0]).toMatchObject({ cmd: ["sh"], cols: 100, rows: 30 });
  expect(a.of("ready")).toMatchObject({ created: true, key: "host", cols: 100, rows: 30 });
  spawned[0]!.onData(bytes("hello "));
  spawned[0]!.onData(bytes("world"));
  expect(a.output).toBe("hello world");

  const b = new FakeClient();
  expect(manager.attach(b, "host", 80, 24, () => { throw new Error("must not start another"); })).toBe(false);
  expect(b.of("ready")).toMatchObject({ created: false, cols: 80, rows: 24 });
  expect(b.output).toBe("hello world");
  // the size is the last one asked for
  expect(spawned[0]!.sizes).toEqual([[80, 24]]);
  expect(manager.list()).toMatchObject([{ key: "host", clients: 2 }]);

  manager.input(a, bytes("ls\r"));
  expect(Buffer.from(spawned[0]!.written[0] as Uint8Array).toString()).toBe("ls\r");
  manager.resize(b, 90, 20);
  expect(spawned[0]!.sizes.at(-1)).toEqual([90, 20]);
  spawned[0]!.onData(bytes("!"));
  expect(a.output).toBe("hello world!");
  expect(b.output).toBe("hello world!");
});

test("only the tail of a long output is kept for the next connection", () => {
  const { spawn, spawned } = fakePty();
  const manager = new TerminalManager({ spawn });
  manager.attach(new FakeClient(), "host", 80, 24, start);
  const chunk = new Uint8Array(64 * 1024).fill(65);
  for (let i = 0; i < 10; i++) spawned[0]!.onData(chunk);
  const late = new FakeClient();
  manager.attach(late, "host", 80, 24, start);
  const got = late.bytes.reduce((sum, part) => sum + part.length, 0);
  expect(got).toBeGreaterThanOrEqual(MAX_REPLAY_BYTES);
  expect(got).toBeLessThan(MAX_REPLAY_BYTES + chunk.length);
});

test("the shell outlives its connections and is closed after being left alone", async () => {
  const { spawn, spawned } = fakePty();
  const manager = new TerminalManager({ spawn, idleMs: 40 });
  const a = new FakeClient();
  manager.attach(a, "host", 80, 24, start);
  manager.detach(a);
  expect(manager.has("host")).toBe(true);
  // coming back in time keeps it
  await Bun.sleep(20);
  const b = new FakeClient();
  manager.attach(b, "host", 80, 24, start);
  await Bun.sleep(60);
  expect(manager.has("host")).toBe(true);
  manager.detach(b);
  await until(() => !manager.has("host"));
  expect(spawned[0]!.signals).toEqual(["SIGHUP"]);
});

test("when the shell ends, every connection is told and closed", async () => {
  const { spawn, spawned } = fakePty();
  let changes = 0;
  const manager = new TerminalManager({ spawn, onChange: () => changes++ });
  const a = new FakeClient();
  manager.attach(a, "app:memos:memos", 80, 24, start);
  spawned[0]!.exit(0);
  await until(() => a.closed !== null);
  expect(a.of("exit")).toEqual({ type: "exit", code: 0 });
  expect(a.closed).toEqual({ code: 1000, reason: "exit" });
  expect(manager.has("app:memos:memos")).toBe(false);
  expect(changes).toBe(2);
  // input after the end goes nowhere
  manager.input(a, bytes("x"));
  expect(spawned[0]!.written).toHaveLength(0);
  // the next connection starts a new shell
  manager.attach(new FakeClient(), "app:memos:memos", 80, 24, start);
  expect(spawned).toHaveLength(2);
});

test("closing by key hangs the shell up; an unknown key is not there", async () => {
  const { spawn, spawned } = fakePty();
  const manager = new TerminalManager({ spawn });
  const a = new FakeClient();
  manager.attach(a, "host", 80, 24, start);
  expect(manager.kill("nope")).toBe(false);
  expect(manager.kill("host")).toBe(true);
  await until(() => a.closed !== null);
  expect(spawned[0]!.signals).toEqual(["SIGHUP"]);
  expect(a.of("exit")).toEqual({ type: "exit", code: 129 });
});

test("there is a limit on terminals, and a failed start is reported as such", () => {
  const { spawn } = fakePty();
  const manager = new TerminalManager({ spawn, max: 1 });
  manager.attach(new FakeClient(), "host", 80, 24, start);
  expect(() => manager.attach(new FakeClient(), "app:a:a", 80, 24, start)).toThrow(TerminalError);
  const broken = new TerminalManager({ spawn: () => { throw new Error("no pty"); } });
  let kind = "";
  try {
    broken.attach(new FakeClient(), "host", 80, 24, start);
  } catch (e) {
    kind = (e as TerminalError).kind;
  }
  expect(kind).toBe("spawn");
  expect(broken.has("host")).toBe(false);
});

test("a browser that does not keep up is cut off, the others go on", () => {
  const { spawn, spawned } = fakePty();
  const manager = new TerminalManager({ spawn });
  const slow = new FakeClient();
  const fast = new FakeClient();
  manager.attach(slow, "host", 80, 24, start);
  manager.attach(fast, "host", 80, 24, start);
  slow.buffered = MAX_BUFFERED_BYTES + 1;
  spawned[0]!.onData(bytes("data"));
  expect(slow.closed).toEqual({ code: WS_SLOW_CLIENT, reason: "slow" });
  expect(slow.output).toBe("");
  expect(fast.output).toBe("data");
  expect(manager.list()[0]!.clients).toBe(1);
});

test.skipIf(!ptySupported())("a real shell on a pseudo-terminal answers", async () => {
  const manager = new TerminalManager();
  const client = new FakeClient();
  manager.attach(client, "host", 80, 24, () => ({ cmd: ["/bin/sh"], cwd: "/", env: terminalEnv({ PATH: process.env.PATH, PS1: "$ " }) }));
  manager.input(client, bytes("echo $((6*7)) && tty\r"));
  await until(() => /42[\s\S]*\/dev\//.test(client.output));
  manager.input(client, bytes("exit 3\r"));
  await until(() => client.closed !== null);
  expect(client.of("exit")).toEqual({ type: "exit", code: 3 });
});
