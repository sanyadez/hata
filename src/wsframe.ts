/**
 * WebSocket frames for the client side (RFC 6455), with no side effects: Hata speaks to Proxmox's
 * console over a TLS connection it has checked itself, so it cannot hand the socket to `WebSocket`.
 * A client masks what it sends; a server does not mask what it answers.
 */

export const TEXT = 1;
export const BINARY = 2;
export const CLOSE = 8;
export const PING = 9;
export const PONG = 10;

/** One frame from the client: final, masked */
export function encodeFrame(opcode: number, payload: Uint8Array, mask = crypto.getRandomValues(new Uint8Array(4))): Uint8Array {
  const n = payload.length;
  const head = n < 126 ? 2 : n < 65536 ? 4 : 10;
  const out = new Uint8Array(head + 4 + n);
  out[0] = 0x80 | opcode;
  if (n < 126) out[1] = 0x80 | n;
  else if (n < 65536) {
    out[1] = 0x80 | 126;
    out[2] = n >> 8;
    out[3] = n & 255;
  } else {
    out[1] = 0x80 | 127;
    new DataView(out.buffer).setBigUint64(2, BigInt(n));
  }
  out.set(mask, head);
  for (let i = 0; i < n; i++) out[head + 4 + i] = payload[i]! ^ mask[i % 4]!;
  return out;
}

/** Reads the server's frames out of what arrives in pieces; fragments are put together */
export class FrameReader {
  private buf = new Uint8Array(0);
  private parts: Uint8Array[] = [];
  private partOp = 0;

  /** The whole messages this piece completes */
  push(chunk: Uint8Array): { opcode: number; data: Uint8Array }[] {
    const joined = new Uint8Array(this.buf.length + chunk.length);
    joined.set(this.buf);
    joined.set(chunk, this.buf.length);
    this.buf = joined;
    const out: { opcode: number; data: Uint8Array }[] = [];
    for (;;) {
      const b = this.buf;
      if (b.length < 2) break;
      const fin = (b[0]! & 0x80) !== 0;
      const opcode = b[0]! & 0x0f;
      const masked = (b[1]! & 0x80) !== 0;
      let len = b[1]! & 0x7f;
      let at = 2;
      if (len === 126) {
        if (b.length < 4) break;
        len = (b[2]! << 8) | b[3]!;
        at = 4;
      } else if (len === 127) {
        if (b.length < 10) break;
        len = Number(new DataView(b.buffer, b.byteOffset).getBigUint64(2));
        at = 10;
      }
      const maskAt = at;
      if (masked) at += 4;
      if (b.length < at + len) break;
      let data = b.slice(at, at + len);
      if (masked) data = data.map((x, i) => x ^ b[maskAt + (i % 4)]!);
      this.buf = b.slice(at + len);
      if (opcode >= 8) {
        // control frames come whole, even between the pieces of a message
        out.push({ opcode, data });
      } else if (opcode !== 0 && fin) {
        out.push({ opcode, data });
      } else {
        if (opcode !== 0) this.partOp = opcode;
        this.parts.push(data);
        if (fin) {
          const whole = new Uint8Array(this.parts.reduce((s, p) => s + p.length, 0));
          let o = 0;
          for (const p of this.parts) (whole.set(p, o), (o += p.length));
          out.push({ opcode: this.partOp, data: whole });
          this.parts = [];
        }
      }
    }
    return out;
  }
}

/** The `Sec-WebSocket-Accept` a server must answer for a key */
export async function acceptFor(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"));
  return Buffer.from(digest).toString("base64");
}

/** Proxmox's terminal protocol: what is typed, a new size, a sign of life */
export function typed(bytes: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(`0:${bytes.length}:`);
  const out = new Uint8Array(head.length + bytes.length);
  out.set(head);
  out.set(bytes, head.length);
  return out;
}

export const sized = (cols: number, rows: number): string => `1:${cols}:${rows}:`;
export const PVE_PING = "2";
