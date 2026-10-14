import { describe, expect, test } from "bun:test";
import { keyPair, linkKeys, Opener, readHello, Sealer, splitCode } from "../src/link";
import { decodeFrame, encodeFrame, MuxError, Peer, WINDOW } from "../src/mux";

async function handshake(secretClient = "", secretHata = "", hataKnown?: string) {
  const [client, hata, ec, eh] = await Promise.all([keyPair(), keyPair(), keyPair(), keyPair()]);
  const hello = JSON.stringify({ hata: "link", v: 1, e: ec.publicKey, s: client.publicKey });
  const answer = JSON.stringify({ e: eh.publicKey });
  const c = await linkKeys("client", { staticKey: client.privateKey, ephemeral: ec.privateKey }, { staticKey: hataKnown ?? hata.publicKey, ephemeral: eh.publicKey }, hello, answer, secretClient);
  const h = await linkKeys("hata", { staticKey: hata.privateKey, ephemeral: eh.privateKey }, { staticKey: client.publicKey, ephemeral: ec.publicKey }, hello, answer, secretHata);
  return { c, h };
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);
const bytes = (s: string) => new TextEncoder().encode(s);

describe("link", () => {
  test("both sides agree and frames open in order", async () => {
    const { c, h } = await handshake();
    const up = new Sealer(c.up);
    const down = new Opener(h.up);
    const a = await up.seal(bytes("one"));
    const b = await up.seal(bytes("two"));
    expect(text(await down.open(a))).toBe("one");
    expect(text(await down.open(b))).toBe("two");
    const back = await new Sealer(h.down).seal(bytes("three"));
    expect(text(await new Opener(c.down).open(back))).toBe("three");
  });

  test("a frame repeated or out of order fails", async () => {
    const { c, h } = await handshake();
    const up = new Sealer(c.up);
    const a = await up.seal(bytes("one"));
    const b = await up.seal(bytes("two"));
    await expect(new Opener(h.up).open(b)).rejects.toThrow();
    const opener = new Opener(h.up);
    await opener.open(a);
    await expect(opener.open(a)).rejects.toThrow();
  });

  test("a stranger posing as Hata gets other keys", async () => {
    const stranger = await keyPair();
    const { c, h } = await handshake("", "", stranger.publicKey);
    const sealed = await new Sealer(c.up).seal(bytes("secret"));
    await expect(new Opener(h.up).open(sealed)).rejects.toThrow();
  });

  test("the pairing code must be the same on both sides", async () => {
    const same = await handshake("abc", "abc");
    expect(text(await new Opener(same.h.up).open(await new Sealer(same.c.up).seal(bytes("x"))))).toBe("x");
    const other = await handshake("abc", "abd");
    await expect(new Opener(other.h.up).open(await new Sealer(other.c.up).seal(bytes("x")))).rejects.toThrow();
  });

  test("hello and the code are read strictly", async () => {
    const k = await keyPair();
    expect(readHello(JSON.stringify({ hata: "link", v: 1, e: k.publicKey, s: k.publicKey, machine: "m1" }))?.machine).toBe("m1");
    expect(readHello(JSON.stringify({ hata: "link", v: 2, e: k.publicKey, s: k.publicKey }))).toBeNull();
    expect(readHello(JSON.stringify({ hata: "link", v: 1, e: "AAAA", s: k.publicKey }))).toBeNull();
    expect(readHello("not json")).toBeNull();
    expect(splitCode("ab12cd34.0123456789abcdefghijkl")).toEqual({ invite: "ab12cd34", secret: "0123456789abcdefghijkl" });
    expect(splitCode("ab12cd34")).toBeNull();
    expect(splitCode("../x.0123456789abcdefghijkl")).toBeNull();
  });
});

/** Two peers joined directly; frames are delivered asynchronously, as over a socket */
function pair(handlers: ConstructorParameters<typeof Peer>[0]["handlers"] = {}) {
  let hata!: Peer;
  let client!: Peer;
  const events: [string, unknown][] = [];
  hata = new Peer({ side: "hata", send: (f) => queueMicrotask(() => client.receive(f)), onEvent: (n, v) => events.push([n, v]) });
  client = new Peer({ side: "client", send: (f) => queueMicrotask(() => hata.receive(f)), handlers });
  return { hata, client, events };
}

describe("mux", () => {
  test("frames keep header and body", () => {
    const f = decodeFrame(encodeFrame({ t: "data", id: 4 }, bytes("body")));
    expect(f?.header).toEqual({ t: "data", id: 4 });
    expect(text(f!.body)).toBe("body");
    expect(decodeFrame(new Uint8Array([0, 0, 0, 9, 1]))).toBeNull();
  });

  test("a call returns what the operation returns, or its error", async () => {
    const { hata } = pair({
      add: ({ a, b }) => a + b,
      fail: () => {
        throw new MuxError("files.notFound", "gone", { path: "/x" });
      },
      crash: () => {
        throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
      },
    });
    expect(await hata.call("add", { a: 2, b: 3 })).toBe(5);
    const e = await hata.call("fail").catch((e) => e);
    expect(e).toBeInstanceOf(MuxError);
    expect([e.code, e.message, e.detail.path]).toEqual(["files.notFound", "gone", "/x"]);
    expect((await hata.call("crash").catch((e) => e)).code).toBe("request.failed");
    expect((await hata.call("nothing").catch((e) => e)).code).toBe("machine.unknownOperation");
  });

  test("a stream carries bytes both ways and controls", async () => {
    const { hata } = pair({
      echo: async (_args, ch) => {
        ch.onControl((m) => ch.control({ seen: m.size }));
        let total = 0;
        for (let chunk = await ch.read(); chunk; chunk = await ch.read()) {
          total += chunk.length;
          await ch.send(chunk);
        }
        return total;
      },
    });
    const ch = hata.open("echo");
    const seen: unknown[] = [];
    ch.onControl((m) => seen.push(m.seen));
    ch.control({ size: 7 });
    await ch.send(bytes("hello "));
    await ch.send(bytes("world"));
    ch.end();
    const got = await new Response(ch.readable()).text();
    expect(got).toBe("hello world");
    expect(await ch.result).toBe(11);
    expect(seen).toEqual([7]);
  });

  test("a sender waits while the reader is behind", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { hata } = pair({
      slow: async (_args, ch) => {
        await gate;
        let total = 0;
        for (let chunk = await ch.read(); chunk; chunk = await ch.read()) total += chunk.length;
        return total;
      },
    });
    const ch = hata.open("slow");
    let sent = 0;
    const writing = (async () => {
      for (let i = 0; i < 40; i++) {
        await ch.send(new Uint8Array(64 * 1024));
        sent += 64 * 1024;
      }
      ch.end();
    })();
    await Bun.sleep(30);
    expect(sent).toBeLessThanOrEqual(WINDOW);
    release();
    await writing;
    expect(await ch.result).toBe(40 * 64 * 1024);
  });

  test("cancel aborts the operation; a lost link fails every channel", async () => {
    let aborted = false;
    const { hata, client } = pair({
      wait: (_args, ch) =>
        new Promise((resolve) => {
          ch.signal.addEventListener("abort", () => {
            aborted = true;
            resolve("stopped");
          });
        }),
    });
    const ch = hata.open("wait");
    await Bun.sleep(5);
    ch.cancel();
    expect(await ch.result).toBe("stopped");
    expect(aborted).toBe(true);
    const pending = hata.call("wait");
    hata.close();
    client.close();
    expect((await pending.catch((e) => e)).code).toBe("link.lost");
    expect(() => hata.open("wait")).toThrow();
  });

  test("events reach the other side", async () => {
    const { client, events } = pair();
    client.event("status", { cpu: 5 });
    await Bun.sleep(1);
    expect(events).toEqual([["status", { cpu: 5 }]]);
  });
});
