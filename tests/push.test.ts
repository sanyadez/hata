import { expect, test } from "bun:test";
import { b64u, cleanSubscription, encryptPayload, fromB64u, generateVapid, sendPush, vapidAuthorization } from "../src/push";

const text = (s: string) => new Uint8Array(new TextEncoder().encode(s));

/** A key pair of a device, as a browser makes it when subscribing */
async function deviceKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const p256dh = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, p256dh, auth };
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** What the device does with a message, written apart from the server's code (RFC 8291) */
async function decrypt(body: Uint8Array, device: Awaited<ReturnType<typeof deviceKeys>>): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, device.pair.privateKey, 256));
  const info = new Uint8Array([...text("WebPush: info\0"), ...device.p256dh, ...asPublic]);
  const ikm = await hkdf(device.auth, ecdh, info, 32);
  const cek = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, cipher));
  expect(plain[plain.length - 1]).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

test("encryption gives the bytes of the example in RFC 8291, appendix A", async () => {
  const body = await encryptPayload(
    fromB64u("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"),
    fromB64u("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
    fromB64u("BTBZMqHH6r4Tts7J_aSIgg"),
    {
      salt: fromB64u("DGv6ra1nlYgDCS1FRnbzlw"),
      publicKey: fromB64u("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"),
      privateKey: fromB64u("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
    },
  );
  expect(b64u(body)).toBe("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
});

test("the device reads what was encrypted for it; every message has its own salt", async () => {
  const device = await deviceKeys();
  const payload = JSON.stringify({ title: "Диск /DATA заповнений на 91%" });
  const a = await encryptPayload(text(payload), device.p256dh, device.auth);
  const b = await encryptPayload(text(payload), device.p256dh, device.auth);
  expect(await decrypt(a, device)).toBe(payload);
  expect(b64u(a.slice(0, 16))).not.toBe(b64u(b.slice(0, 16)));
  expect(new DataView(a.buffer).getUint32(16)).toBe(4096);
});

test("the VAPID signature verifies with the server's public key", async () => {
  const vapid = await generateVapid();
  const now = Date.UTC(2026, 9, 10, 12);
  const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", "https://hata.example", vapid, now);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
  expect(m[4]).toBe(vapid.publicKey);
  expect(JSON.parse(new TextDecoder().decode(fromB64u(m[2]!)))).toEqual({ aud: "https://fcm.googleapis.com", exp: now / 1000 + 12 * 3600, sub: "https://hata.example" });
  const key = await crypto.subtle.importKey("raw", fromB64u(vapid.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, fromB64u(m[3]!), text(`${m[1]}.${m[2]}`))).toBe(true);
});

test("a subscription is taken only with an HTTPS address and keys of the right size", async () => {
  const d = await deviceKeys();
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: b64u(d.p256dh), auth: b64u(d.auth) } };
  expect(cleanSubscription({ ...sub, expirationTime: null })).toEqual(sub);
  for (const endpoint of ["http://fcm.googleapis.com/x", "https://user:pw@push.example/x", "file:///etc/passwd", "", 5]) expect(cleanSubscription({ ...sub, endpoint })).toBeNull();
  expect(cleanSubscription({ ...sub, keys: { ...sub.keys, p256dh: b64u(new Uint8Array(65)) } })).toBeNull();
  expect(cleanSubscription({ ...sub, keys: { ...sub.keys, auth: "AAAA" } })).toBeNull();
  expect(cleanSubscription({ endpoint: sub.endpoint })).toBeNull();
  expect(cleanSubscription("x")).toBeNull();
});

test("sending: the device can read the request's body; 410 means the subscription is gone", async () => {
  const d = await deviceKeys();
  const target = { endpoint: "https://push.example/send/x", keys: { p256dh: b64u(d.p256dh), auth: b64u(d.auth) } };
  const vapid = await generateVapid();
  let seen: { url: string; init: RequestInit } | null = null;
  const reply = (status: number) => (async (url: string, init: RequestInit) => ((seen = { url, init }), new Response("no", { status }))) as unknown as typeof fetch;
  expect(await sendPush(target, { title: "Hi" }, vapid, "https://hata.example", reply(201))).toBe("sent");
  expect(seen!.url).toBe(target.endpoint);
  expect((seen!.init.headers as Record<string, string>)["content-encoding"]).toBe("aes128gcm");
  expect(await decrypt(seen!.init.body as Uint8Array, d)).toBe('{"title":"Hi"}');
  expect(await sendPush(target, {}, vapid, "https://hata.example", reply(410))).toBe("gone");
  expect(sendPush(target, {}, vapid, "https://hata.example", reply(403))).rejects.toThrow("push.example: HTTP 403 no");
});
