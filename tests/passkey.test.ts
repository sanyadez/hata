import { expect, test } from "bun:test";
import { b64url, derToRaw, newChallenge, parseAuthData, spendChallenge, verifyAssertion, verifyRegistration, type StoredPasskey } from "../src/passkey";

const RP = "home.example.org";
const enc = new TextEncoder();
const sha = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", data));

/** An authenticator made of WebCrypto: builds what a browser would send back */
async function authenticator(alg: -7 | -8 | -257) {
  const params = alg === -7 ? { name: "ECDSA", namedCurve: "P-256" } : alg === -8 ? { name: "Ed25519" } : { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
  const pair = (await crypto.subtle.generateKey(params as never, true, ["sign", "verify"])) as CryptoKeyPair;
  const credentialId = crypto.getRandomValues(new Uint8Array(20));
  const authData = async (counter: number, flags: number, rpId = RP, attested = false) => {
    const head = new Uint8Array(37);
    head.set(await sha(enc.encode(rpId)));
    head[32] = flags | (attested ? 0x40 : 0);
    new DataView(head.buffer).setUint32(33, counter);
    if (!attested) return head;
    const tail = new Uint8Array(16 + 2 + credentialId.length + 3);
    new DataView(tail.buffer).setUint16(16, credentialId.length);
    tail.set(credentialId, 18);
    return new Uint8Array([...head, ...tail]);
  };
  const clientData = (type: string, challenge: string, origin = `https://${RP}`) => enc.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  const rawToDer = (raw: Uint8Array) => {
    const int = (bytes: Uint8Array) => {
      let b = bytes;
      while (b.length > 1 && b[0] === 0) b = b.subarray(1);
      const body = b[0]! & 0x80 ? [0, ...b] : [...b];
      return [0x02, body.length, ...body];
    };
    const body = [...int(raw.subarray(0, 32)), ...int(raw.subarray(32))];
    return new Uint8Array([0x30, body.length, ...body]);
  };
  return {
    credentialId,
    async register(challenge: string, over: { flags?: number; rpId?: string; origin?: string; type?: string } = {}) {
      return {
        clientDataJSON: b64url(clientData(over.type ?? "webauthn.create", challenge, over.origin)),
        authenticatorData: b64url(await authData(0, over.flags ?? 0x05, over.rpId, true)),
        publicKey: b64url(new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey))),
        alg,
      };
    },
    async sign(challenge: string, counter: number, over: { flags?: number; origin?: string } = {}) {
      const data = await authData(counter, over.flags ?? 0x05);
      const client = clientData("webauthn.get", challenge, over.origin);
      const signed = new Uint8Array([...data, ...(await sha(client))]);
      const verify = alg === -7 ? { name: "ECDSA", hash: "SHA-256" } : alg === -8 ? { name: "Ed25519" } : { name: "RSASSA-PKCS1-v1_5" };
      const raw = new Uint8Array(await crypto.subtle.sign(verify, pair.privateKey, signed));
      return { clientDataJSON: b64url(client), authenticatorData: b64url(data), signature: b64url(alg === -7 ? rawToDer(raw) : raw) };
    },
  };
}

for (const alg of [-7, -8, -257] as const) {
  test(`a passkey is registered and then signs in (algorithm ${alg})`, async () => {
    const device = await authenticator(alg);
    const stored = await verifyRegistration(await device.register("c1"), { challenge: "c1", rpId: RP });
    expect(stored).toMatchObject({ id: b64url(device.credentialId), alg, counter: 0 });
    const key: StoredPasskey = { ...stored!, name: "laptop", createdAt: 1 };
    expect(await verifyAssertion(await device.sign("c2", 1), key, { challenge: "c2", rpId: RP })).toEqual({ counter: 1 });
    // an authenticator that does not count keeps sending 0
    expect(await verifyAssertion(await device.sign("c3", 0), key, { challenge: "c3", rpId: RP })).toEqual({ counter: 0 });
  });
}

test("a sign-in is refused when anything about it is not ours", async () => {
  const device = await authenticator(-7);
  const key: StoredPasskey = { ...(await verifyRegistration(await device.register("c"), { challenge: "c", rpId: RP }))!, name: "k", createdAt: 1, counter: 5 };
  const expected = { challenge: "c", rpId: RP };
  expect(await verifyAssertion(await device.sign("c", 6), key, expected)).toEqual({ counter: 6 });
  // another challenge, another site, plain HTTP, a subdomain's page
  expect(await verifyAssertion(await device.sign("other", 6), key, expected)).toBeNull();
  expect(await verifyAssertion(await device.sign("c", 6, { origin: "https://evil.example" }), key, expected)).toBeNull();
  expect(await verifyAssertion(await device.sign("c", 6, { origin: `http://${RP}` }), key, expected)).toBeNull();
  expect(await verifyAssertion(await device.sign("c", 6, { origin: `https://app.${RP}` }), key, expected)).toBeNull();
  // the user was not verified (no fingerprint or PIN), or not even present
  expect(await verifyAssertion(await device.sign("c", 6, { flags: 0x01 }), key, expected)).toBeNull();
  expect(await verifyAssertion(await device.sign("c", 6, { flags: 0x04 }), key, expected)).toBeNull();
  // the counter went back: a copy of the key
  expect(await verifyAssertion(await device.sign("c", 5), key, expected)).toBeNull();
  // someone else's key, a mangled signature
  expect(await verifyAssertion(await (await authenticator(-7)).sign("c", 6), key, expected)).toBeNull();
  const answer = await device.sign("c", 6);
  expect(await verifyAssertion({ ...answer, signature: answer.signature.slice(0, -4) + "AAAA" }, key, expected)).toBeNull();
  expect(await verifyAssertion({ ...answer, signature: 5 }, key, expected)).toBeNull();
});

test("a registration is refused when it is not ours or not verified", async () => {
  const device = await authenticator(-7);
  const expected = { challenge: "c", rpId: RP };
  expect(await verifyRegistration(await device.register("c"), expected)).not.toBeNull();
  expect(await verifyRegistration(await device.register("x"), expected)).toBeNull();
  expect(await verifyRegistration(await device.register("c", { rpId: "other.example" }), expected)).toBeNull();
  expect(await verifyRegistration(await device.register("c", { origin: "https://other.example" }), expected)).toBeNull();
  expect(await verifyRegistration(await device.register("c", { type: "webauthn.get" }), expected)).toBeNull();
  expect(await verifyRegistration(await device.register("c", { flags: 0x01 }), expected)).toBeNull();
  expect(await verifyRegistration({ ...(await device.register("c")), alg: -999 }, expected)).toBeNull();
  expect(await verifyRegistration({ ...(await device.register("c")), publicKey: b64url(new Uint8Array(40)) }, expected)).toBeNull();
});

test("a challenge works once, and only for what it was issued for", () => {
  const client = (challenge: string) => b64url(enc.encode(JSON.stringify({ challenge })));
  const a = newChallenge("signin");
  expect(spendChallenge(client(a), "add:someone")).toBeNull();
  expect(spendChallenge(client(a), "signin")).toBe(a);
  expect(spendChallenge(client(a), "signin")).toBeNull();
  expect(spendChallenge(client("made-up"), "signin")).toBeNull();
  expect(spendChallenge("not json", "signin")).toBeNull();
});

test("authenticator data and signatures are parsed strictly", () => {
  expect(parseAuthData(new Uint8Array(36))).toBeNull();
  const attested = new Uint8Array(55);
  attested[32] = 0x40;
  new DataView(attested.buffer).setUint16(53, 20);
  expect(parseAuthData(attested)).toBeNull();
  expect(derToRaw(new Uint8Array([0x30, 6, 2, 1, 5, 2, 1, 7]))).toEqual(new Uint8Array([...new Array(31).fill(0), 5, ...new Array(31).fill(0), 7]));
  expect(derToRaw(new Uint8Array([0x30, 6, 2, 1, 5, 2, 1, 7, 0]))).toBeNull();
  expect(derToRaw(new Uint8Array([0x31, 0]))).toBeNull();
});
