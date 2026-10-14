/**
 * Calls and streams over one connection between Hata and a machine's client. Pure: the frames go
 * through `send` and come back through `receive`, so the tests join two peers directly.
 *
 * A frame is a JSON header and, after it, raw bytes: `u32 header length ‖ header ‖ body`.
 *
 * - `open` starts a channel: the other side runs the named operation with the arguments and the
 *   channel; what it returns ends the channel (`ok`) or what it throws (`err`). A plain call is a
 *   channel nobody writes to.
 * - `data` carries bytes either way, `ctl` a small object (a terminal's size), `end` says one side
 *   will write no more, `cancel` asks the operation to stop.
 * - `ack` is flow control: a side sends at most `WINDOW` bytes the other has not taken yet, so a file
 *   read faster than the browser downloads it waits instead of filling the memory.
 * - `event` is news without an answer (the machine's state every few seconds).
 *
 * Each side numbers the channels it opens: Hata even, the client odd.
 */

export const WINDOW = 1024 * 1024;
/** The largest piece of data in one frame */
export const CHUNK = 64 * 1024;

export interface Header {
  t: "open" | "data" | "ctl" | "end" | "cancel" | "ok" | "err" | "ack" | "event";
  id?: number;
  [key: string]: unknown;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeFrame(header: Header, body?: Uint8Array): Uint8Array {
  const head = encoder.encode(JSON.stringify(header));
  const out = new Uint8Array(4 + head.length + (body?.length ?? 0));
  new DataView(out.buffer).setUint32(0, head.length);
  out.set(head, 4);
  if (body) out.set(body, 4 + head.length);
  return out;
}

export function decodeFrame(frame: Uint8Array): { header: Header; body: Uint8Array } | null {
  if (frame.length < 4) return null;
  const size = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0);
  if (4 + size > frame.length) return null;
  try {
    const header = JSON.parse(decoder.decode(frame.subarray(4, 4 + size)));
    if (typeof header?.t !== "string") return null;
    return { header, body: frame.subarray(4 + size) };
  } catch {
    return null;
  }
}

/** A failure the other side can word: `code` is a key of the UI's `error.*` strings */
export class MuxError extends Error {
  constructor(
    readonly code: string,
    message = code,
    readonly detail: Record<string, string | number> = {},
  ) {
    super(message);
  }
}

export type Handler = (args: any, channel: Channel) => unknown;

export class Channel {
  /** Bytes sent and not yet taken by the other side */
  private inflight = 0;
  private waiting: (() => void)[] = [];
  private queue: Uint8Array[] = [];
  private pulled: ((chunk: Uint8Array | null) => void) | null = null;
  private ended = false;
  private failure: Error | null = null;
  private controls: ((message: Record<string, unknown>) => void)[] = [];
  private readonly abort = new AbortController();
  /** On the side that opened the channel: what the operation returned */
  result!: Promise<unknown>;
  settle: { resolve: (v: unknown) => void; reject: (e: Error) => void } = { resolve: () => {}, reject: () => {} };

  constructor(
    private readonly peer: Peer,
    readonly id: number,
  ) {
    this.result = new Promise((resolve, reject) => (this.settle = { resolve, reject }));
    // nobody may ask for the result of a stream
    this.result.catch(() => {});
  }

  /** Aborted when the opener cancels or the connection is lost: the operation should stop */
  get signal(): AbortSignal {
    return this.abort.signal;
  }

  /** Sends bytes, waiting while the other side has a window's worth not taken yet */
  async send(bytes: Uint8Array): Promise<void> {
    for (let at = 0; at < bytes.length; at += CHUNK) {
      const piece = bytes.subarray(at, at + CHUNK);
      while (this.inflight >= WINDOW) {
        if (this.peer.closed || this.abort.signal.aborted) throw new MuxError("link.lost");
        await new Promise<void>((resolve) => this.waiting.push(resolve));
      }
      if (this.peer.closed) throw new MuxError("link.lost");
      this.inflight += piece.length;
      this.peer.frame({ t: "data", id: this.id }, piece);
    }
  }

  control(message: Record<string, unknown>): void {
    this.peer.frame({ t: "ctl", id: this.id, m: message });
  }

  onControl(listener: (message: Record<string, unknown>) => void): void {
    this.controls.push(listener);
  }

  /** This side will send no more bytes */
  end(): void {
    this.peer.frame({ t: "end", id: this.id });
  }

  /** On the opening side: asks the operation to stop */
  cancel(): void {
    if (this.peer.closed) return;
    this.peer.frame({ t: "cancel", id: this.id });
  }

  /** The next piece of bytes from the other side; null once it has ended */
  async read(): Promise<Uint8Array | null> {
    const chunk = this.queue.shift();
    if (chunk) {
      this.peer.frame({ t: "ack", id: this.id, n: chunk.length });
      return chunk;
    }
    if (this.failure) throw this.failure;
    if (this.ended) return null;
    const next = await new Promise<Uint8Array | null>((resolve) => (this.pulled = resolve));
    if (next) this.peer.frame({ t: "ack", id: this.id, n: next.length });
    else if (this.failure) throw this.failure;
    return next;
  }

  /** The bytes from the other side as a stream; cancelling it cancels the channel */
  readable(): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        try {
          const chunk = await this.read();
          if (chunk) controller.enqueue(chunk);
          else controller.close();
        } catch (e) {
          controller.error(e);
        }
      },
      cancel: () => this.cancel(),
    });
  }

  // --- what the peer tells the channel ---

  gotData(body: Uint8Array): void {
    // the frame's buffer is reused by nobody, but a copy keeps a large frame from being held whole
    const chunk = body.slice();
    if (this.pulled) {
      const pulled = this.pulled;
      this.pulled = null;
      pulled(chunk);
    } else this.queue.push(chunk);
  }

  gotAck(n: number): void {
    this.inflight = Math.max(0, this.inflight - n);
    for (const wake of this.waiting.splice(0)) wake();
  }

  gotControl(message: Record<string, unknown>): void {
    for (const listener of this.controls) {
      try {
        listener(message);
      } catch {
        // a listener's trouble is not the channel's
      }
    }
  }

  gotEnd(): void {
    this.ended = true;
    if (this.pulled) {
      const pulled = this.pulled;
      this.pulled = null;
      pulled(null);
    }
  }

  gotCancel(): void {
    this.abort.abort();
    for (const wake of this.waiting.splice(0)) wake();
  }

  fail(error: Error): void {
    this.failure ??= error;
    this.settle.reject(error);
    this.gotCancel();
    this.gotEnd();
  }
}

export interface PeerOptions {
  /** Puts a frame on the wire; frames must arrive in the order they are given */
  send: (frame: Uint8Array) => void;
  /** The operations the other side may run here */
  handlers?: Record<string, Handler>;
  onEvent?: (name: string, value: unknown) => void;
  /** Whose numbers this side gives its channels: Hata even, the client odd */
  side: "hata" | "client";
}

export class Peer {
  private readonly channels = new Map<number, Channel>();
  private next: number;
  closed = false;

  constructor(private readonly options: PeerOptions) {
    this.next = options.side === "hata" ? 2 : 1;
  }

  frame(header: Header, body?: Uint8Array): void {
    if (this.closed) return;
    this.options.send(encodeFrame(header, body));
  }

  /** Opens a channel to an operation of the other side */
  open(op: string, args: unknown = {}): Channel {
    if (this.closed) throw new MuxError("link.lost");
    const id = this.next;
    this.next += 2;
    const channel = new Channel(this, id);
    this.channels.set(id, channel);
    this.frame({ t: "open", id, op, args });
    return channel;
  }

  /** Runs an operation of the other side and waits for what it returns */
  call<T = unknown>(op: string, args: unknown = {}): Promise<T> {
    return this.open(op, args).result as Promise<T>;
  }

  event(name: string, value: unknown): void {
    this.frame({ t: "event", name, value });
  }

  receive(frame: Uint8Array): void {
    const decoded = decodeFrame(frame);
    if (!decoded) return;
    const { header, body } = decoded;
    if (header.t === "event") return this.options.onEvent?.(String(header.name), header.value);
    const id = Number(header.id);
    if (header.t === "open") return this.run(id, String(header.op), header.args);
    const channel = this.channels.get(id);
    if (!channel) return;
    switch (header.t) {
      case "data":
        return channel.gotData(body);
      case "ack":
        return channel.gotAck(Number(header.n) || 0);
      case "ctl":
        return channel.gotControl((header.m ?? {}) as Record<string, unknown>);
      case "end":
        return channel.gotEnd();
      case "cancel":
        return channel.gotCancel();
      case "ok":
        this.channels.delete(id);
        channel.gotEnd();
        return channel.settle.resolve(header.value);
      case "err":
        this.channels.delete(id);
        return channel.fail(new MuxError(String(header.code ?? "request.failed"), String(header.message ?? header.code ?? ""), (header.detail ?? {}) as Record<string, string>));
    }
  }

  private async run(id: number, op: string, args: unknown): Promise<void> {
    const handler = this.options.handlers?.[op];
    if (!handler) return this.frame({ t: "err", id, code: "machine.unknownOperation", message: op });
    const channel = new Channel(this, id);
    this.channels.set(id, channel);
    try {
      const value = await handler(args ?? {}, channel);
      this.frame({ t: "ok", id, value: value ?? null });
    } catch (e) {
      const own = (e as { code?: unknown })?.code;
      // a code of ours ("files.notFound"), not a system one ("ENOENT")
      const code = e instanceof MuxError ? e.code : typeof own === "string" && /^[a-z]+\.[A-Za-z.]+$/.test(own) ? own : "request.failed";
      this.frame({ t: "err", id, code, message: e instanceof Error ? e.message : String(e), detail: e instanceof MuxError ? e.detail : (e as { detail?: unknown })?.detail ?? {} });
    } finally {
      this.channels.delete(id);
      channel.gotCancel();
    }
  }

  /** The connection is gone: every channel fails */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const channel of this.channels.values()) channel.fail(new MuxError("link.lost"));
    this.channels.clear();
  }
}
