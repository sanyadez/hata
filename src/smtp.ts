/**
 * Sending mail: a small SMTP client on the runtime's own sockets. TLS from the first byte (port 465),
 * STARTTLS (587), or a plain connection for a relay on the home network; AUTH PLAIN or LOGIN when a user
 * is given. The message is one text part, base64 in UTF-8, so no line of it ever starts with a dot.
 *
 * `compose` and `reply` are pure; `sendMail` talks to the server.
 */
import { isIP, connect as plainConnect, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

export type Security = "tls" | "starttls" | "none";

export interface SmtpServer {
  host: string;
  port: number;
  security: Security;
  user: string;
  password: string;
}

export interface Mail {
  from: string;
  to: string[];
  subject: string;
  text: string;
}

/** An address the way Hata takes it: one mailbox, nothing a header or a command could be bent with */
export const EMAIL_RE = /^[^\s@<>()",;:\\\[\]]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,}$/;

/** A header's words in UTF-8, as RFC 2047 wants them when they are not plain ASCII */
export function encodeWords(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  // pieces of whole characters, each encoded word under 75 bytes
  const words: string[] = [];
  let piece = "";
  for (const ch of text) {
    if (Buffer.byteLength(piece + ch) > 45) (words.push(piece), (piece = ""));
    piece += ch;
  }
  if (piece) words.push(piece);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString("base64")}?=`).join("\r\n ");
}

/** The whole message, ready for DATA; lines end in CRLF */
export function compose(mail: Mail, at: Date, id: string, fromName = "Hata"): string {
  const domain = mail.from.split("@")[1] ?? "localhost";
  const body = Buffer.from(mail.text.replace(/\r?\n/g, "\r\n")).toString("base64").replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: ${encodeWords(fromName)} <${mail.from}>`,
    `To: ${mail.to.join(", ")}`,
    `Subject: ${encodeWords(mail.subject)}`,
    `Date: ${at.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${id}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "Auto-Submitted: auto-generated",
    "",
    body,
  ].join("\r\n");
}

/** One reply of the server out of what has arrived: its code and text, or null while it is not whole */
export function reply(buffer: string): { code: number; text: string; rest: string } | null {
  const lines: string[] = [];
  let at = 0;
  for (;;) {
    const end = buffer.indexOf("\n", at);
    if (end < 0) return null;
    const line = buffer.slice(at, end).replace(/\r$/, "");
    at = end + 1;
    lines.push(line.slice(4));
    // "250-…" goes on, "250 …" is the last line
    if (line[3] !== "-") return { code: Number(line.slice(0, 3)) || 0, text: lines.join("\n"), rest: buffer.slice(at) };
  }
}

const TIMEOUT_MS = 20_000;

/** A conversation with the server: write a line, wait for the reply */
class Talk {
  private buffer = "";
  private waiting: ((r: { code: number; text: string }) => void) | null = null;
  private failed: ((e: Error) => void) | null = null;
  constructor(private socket: Socket | TLSSocket) {
    this.listen(socket);
  }
  listen(socket: Socket | TLSSocket): void {
    this.socket = socket;
    // bytes, not a string encoding on the socket: after STARTTLS the same socket carries TLS
    socket.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      const r = reply(this.buffer);
      if (r && this.waiting) {
        this.buffer = r.rest;
        const done = this.waiting;
        this.waiting = this.failed = null;
        done(r);
      }
    });
    socket.on("error", (e) => this.failed?.(e));
    socket.on("close", () => this.failed?.(new Error("the server closed the connection")));
  }
  read(): Promise<{ code: number; text: string }> {
    return new Promise((resolve, reject) => {
      const r = reply(this.buffer);
      if (r) return (this.buffer = r.rest), resolve(r);
      const timer = setTimeout(() => reject(new Error("the server did not answer in time")), TIMEOUT_MS);
      this.waiting = (r) => (clearTimeout(timer), resolve(r));
      this.failed = (e) => (clearTimeout(timer), reject(e));
    });
  }
  async say(line: string, expect: number[], shown = line): Promise<string> {
    this.socket.write(line + "\r\n");
    const r = await this.read();
    if (!expect.includes(r.code)) throw new Error(`${shown.split(" ")[0]}: ${r.code} ${r.text.split("\n").pop()}`);
    return r.text;
  }
  get raw(): Socket | TLSSocket {
    return this.socket;
  }
}

function opened(socket: Socket | TLSSocket, secure: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => (socket.destroy(), reject(new Error("could not connect in time"))), TIMEOUT_MS);
    socket.once(secure ? "secureConnect" : "connect", () => (clearTimeout(timer), resolve()));
    socket.once("error", (e) => (clearTimeout(timer), reject(e)));
  });
}

/** The name the certificate is asked for: a host name, never an address (TLS does not send those) */
const nameOf = (host: string): { servername?: string } => (isIP(host) ? {} : { servername: host });

/** Tests talk to a server with a certificate of its own making */
const checkCertificate = process.env.HATA_SMTP_INSECURE !== "1";

/** Sends one message; throws with what the server said when it does not take it */
export async function sendMail(server: SmtpServer, mail: Mail, name = "hata"): Promise<void> {
  const socket = server.security === "tls" ? tlsConnect({ host: server.host, port: server.port, ...nameOf(server.host), rejectUnauthorized: checkCertificate }) : plainConnect({ host: server.host, port: server.port });
  await opened(socket, server.security === "tls");
  const talk = new Talk(socket);
  try {
    const greeting = await talk.read();
    if (greeting.code !== 220) throw new Error(`greeting: ${greeting.code} ${greeting.text}`);
    const hello = `EHLO ${name.replace(/[^A-Za-z0-9.-]/g, "") || "hata"}`;
    let caps = await talk.say(hello, [250]);
    if (server.security === "starttls") {
      if (!/^STARTTLS$/im.test(caps)) throw new Error("the server does not offer STARTTLS");
      await talk.say("STARTTLS", [220]);
      talk.raw.removeAllListeners("data");
      talk.raw.removeAllListeners("error");
      talk.raw.removeAllListeners("close");
      const secure = tlsConnect({ socket: talk.raw as Socket, ...nameOf(server.host), rejectUnauthorized: checkCertificate });
      await opened(secure, true);
      talk.listen(secure);
      caps = await talk.say(hello, [250]);
    }
    if (server.user) {
      const auth = /^AUTH[ =](.*)$/im.exec(caps)?.[1]?.toUpperCase().split(/\s+/) ?? [];
      if (auth.includes("PLAIN")) {
        await talk.say(`AUTH PLAIN ${Buffer.from(`\0${server.user}\0${server.password}`).toString("base64")}`, [235], "AUTH");
      } else if (auth.includes("LOGIN")) {
        await talk.say("AUTH LOGIN", [334]);
        await talk.say(Buffer.from(server.user).toString("base64"), [334], "AUTH");
        await talk.say(Buffer.from(server.password).toString("base64"), [235], "AUTH");
      } else throw new Error("the server offers no sign-in Hata knows (PLAIN, LOGIN)");
    }
    await talk.say(`MAIL FROM:<${mail.from}>`, [250]);
    for (const to of mail.to) await talk.say(`RCPT TO:<${to}>`, [250, 251]);
    await talk.say("DATA", [354]);
    const id = `${Date.now().toString(36)}.${crypto.randomUUID().slice(0, 8)}`;
    await talk.say(compose(mail, new Date(), id) + "\r\n.", [250], "DATA");
    await talk.say("QUIT", [221]).catch(() => {});
  } finally {
    talk.raw.destroy();
  }
}
