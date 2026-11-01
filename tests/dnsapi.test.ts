import { expect, test } from "bun:test";
import { certificateRequest } from "../src/acme";
import { challengeAnswer, queryFor, readAsk, reply, TYPE, txtData, txtsOf } from "../src/dns";
import { cleanApi, presenterFor, route53Change, zoneCandidates, type DnsApi, type Fetch } from "../src/dnsapi";
import { coveredBy } from "../src/site";

const api = (provider: DnsApi["provider"], rest: Partial<DnsApi> = {}): DnsApi => ({ provider, token: "T", accessKey: "", secret: "", ...rest });

/** A stand-in for a provider: `answer` per request; what was asked is kept */
function stand(answer: (method: string, url: string) => { status?: number; body?: unknown }) {
  const asked: { method: string; path: string; body: any; auth: string }[] = [];
  const f: Fetch = async (url, init) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    asked.push({ method, path: u.pathname + u.search, body: typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body, auth: headers.get("authorization") ?? "" });
    const a = answer(method, u.pathname + u.search);
    return new Response(typeof a.body === "string" ? a.body : JSON.stringify(a.body ?? {}), { status: a.status ?? 200 });
  };
  return { f, asked };
}

const NAME = "_acme-challenge.home.example.com";

test("zoneCandidates: from the whole name up to two labels", () => {
  expect(zoneCandidates("home.example.com")).toEqual(["home.example.com", "example.com"]);
  expect(zoneCandidates("example.com")).toEqual(["example.com"]);
  expect(zoneCandidates(NAME)).toEqual(["home.example.com", "example.com"]);
});

test("Cloudflare: the zone found upwards, the value quoted, only our values deleted", async () => {
  const { f, asked } = stand((method, path) => {
    if (path.includes("name=home.example.com")) return { body: { result: [] } };
    if (path.startsWith("/client/v4/zones?name=example.com")) return { body: { result: [{ id: "Z" }] } };
    if (method === "GET") return { body: { result: [{ id: "1", content: '"v1"' }, { id: "2", content: '"other"' }] } };
    return {};
  });
  const p = presenterFor(api("cloudflare"), f, "http://x");
  await p.add(NAME, ["v1"]);
  expect(asked.at(-1)).toMatchObject({ method: "POST", path: "/client/v4/zones/Z/dns_records", auth: "Bearer T", body: { type: "TXT", name: NAME, content: '"v1"' } });
  await p.remove(NAME, ["v1"]);
  const deleted = asked.filter((a) => a.method === "DELETE").map((a) => a.path);
  expect(deleted).toEqual(["/client/v4/zones/Z/dns_records/1"]);
});

test("deSEC: an RRset made, replaced when it is there, deleted", async () => {
  let exists = false;
  const { f, asked } = stand((method, path) => {
    if (method === "GET") return path === "/api/v1/domains/example.com/" ? {} : { status: 404 };
    if (method === "POST") return exists ? { status: 400, body: {} } : { status: 201 };
    return {};
  });
  const p = presenterFor(api("desec"), f, "http://x");
  await p.add(NAME, ["a", "b"]);
  expect(asked.at(-1)).toMatchObject({ path: "/api/v1/domains/example.com/rrsets/", auth: "Token T", body: { subname: "_acme-challenge.home", type: "TXT", ttl: 3600, records: ['"a"', '"b"'] } });
  exists = true;
  await p.add(NAME, ["a"]);
  expect(asked.at(-1)).toMatchObject({ method: "PATCH", path: "/api/v1/domains/example.com/rrsets/_acme-challenge.home/TXT/" });
  await p.remove(NAME, ["a"]);
  expect(asked.at(-1)).toMatchObject({ method: "DELETE", path: "/api/v1/domains/example.com/rrsets/_acme-challenge.home/TXT/" });
});

test("DuckDNS: the one label, one value at a time, KO is a refusal", async () => {
  const { f, asked } = stand(() => ({ body: "OK" }));
  const p = presenterFor(api("duckdns"), f, "http://x");
  expect(p.oneAtATime).toBe(true);
  await p.add("_acme-challenge.myhome.duckdns.org", ["v"]);
  expect(asked.at(-1)?.path).toBe("/update?domains=myhome&token=T&txt=v");
  await p.remove("_acme-challenge.myhome.duckdns.org", ["v"]);
  expect(asked.at(-1)?.path).toBe("/update?domains=myhome&token=T&clear=true");
  const no = presenterFor(api("duckdns"), stand(() => ({ body: "KO" })).f, "http://x");
  await expect(no.check("myhome.duckdns.org")).rejects.toThrow("DuckDNS refused");
  await expect(presenterFor(api("duckdns"), f, "http://x").check("example.com")).rejects.toThrow("not under duckdns.org");
});

test("Hetzner, DigitalOcean, Gandi: their own paths and bodies", async () => {
  const zone = (ok: string) => (method: string, path: string) => (method === "GET" && path.includes("/records") ? { body: { domain_records: [{ id: 7, data: "v" }, { id: 8, data: "x" }] } } : method === "GET" && !path.endsWith(ok) ? { status: 404 } : {});
  const h = stand(zone("/v1/zones/example.com"));
  await presenterFor(api("hetzner"), h.f, "http://x").add(NAME, ["v"]);
  expect(h.asked.at(-1)).toMatchObject({ path: "/v1/zones/example.com/rrsets/_acme-challenge.home/TXT/actions/add_records", body: { ttl: 60, records: [{ value: '"v"' }] } });
  await presenterFor(api("hetzner"), h.f, "http://x").remove(NAME, ["v"]);
  expect(h.asked.at(-1)?.path).toEndWith("/actions/remove_records");
  const d = stand(zone("/v2/domains/example.com"));
  await presenterFor(api("digitalocean"), d.f, "http://x").add(NAME, ["v"]);
  expect(d.asked.at(-1)).toMatchObject({ path: "/v2/domains/example.com/records", body: { type: "TXT", name: "_acme-challenge.home", data: "v" } });
  await presenterFor(api("digitalocean"), d.f, "http://x").remove(NAME, ["v"]);
  expect(d.asked.filter((a) => a.method === "DELETE").map((a) => a.path)).toEqual(["/v2/domains/example.com/records/7"]);
  const g = stand(zone("/v5/livedns/domains/example.com"));
  await presenterFor(api("gandi"), g.f, "http://x").add(NAME, ["v"]);
  expect(g.asked.at(-1)).toMatchObject({ method: "PUT", path: "/v5/livedns/domains/example.com/records/_acme-challenge.home/TXT", body: { rrset_values: ['"v"'] } });
});

test("Route 53: signed for its own service, the whole set of values", async () => {
  const { f, asked } = stand((method) => (method === "GET" ? { body: "<ListHostedZonesByNameResponse><HostedZones><HostedZone><Id>/hostedzone/ABC</Id><Name>example.com.</Name></HostedZone></HostedZones></ListHostedZonesByNameResponse>" } : { body: "<ok/>" }));
  await presenterFor(api("route53", { token: "", accessKey: "AK", secret: "S" }), f, "http://x").add(NAME, ["v"]);
  expect(asked.at(-1)?.path).toBe("/2013-04-01/hostedzone/ABC/rrset");
  expect(asked.at(-1)?.auth).toContain("/us-east-1/route53/aws4_request");
  expect(route53Change("UPSERT", NAME, ["v"])).toContain(`<Name>${NAME}.</Name><Type>TXT</Type>`);
  expect(route53Change("UPSERT", NAME, ["v"])).toContain("<Value>&quot;v&quot;</Value>");
});

test("a refusal comes in the provider's words", async () => {
  const { f } = stand(() => ({ status: 403, body: { errors: [{ message: "Authentication error" }] } }));
  await expect(presenterFor(api("cloudflare"), f, "http://x").check("example.com")).rejects.toThrow("HTTP 403: Authentication error");
});

test("cleanApi: an empty secret keeps the saved one, of the same provider only", () => {
  const kept = api("cloudflare");
  expect(cleanApi({ provider: "cloudflare", token: "" }, kept)?.token).toBe("T");
  expect(cleanApi({ provider: "desec", token: "" }, kept)).toBeNull();
  expect(cleanApi({ provider: "desec", token: "N" }, kept)?.token).toBe("N");
  expect(cleanApi({ provider: "route53", accessKey: "A" }, null)).toBeNull();
  expect(cleanApi({ provider: "nope", token: "N" }, null)).toBeNull();
});

test("a delegated confirmation: TXT values read back, NS and SOA of that one name", () => {
  const q = queryFor(NAME, TYPE.TXT, 5);
  const ask = readAsk(q)!;
  const made = challengeAnswer(ask, "home.example.com", ["one", "two"]);
  expect(txtsOf(reply(q, ask, made.rcode, made.answers))).toEqual(["one", "two"]);
  expect(challengeAnswer(ask, "home.example.com", []).answers).toEqual([]);
  expect(challengeAnswer(readAsk(queryFor(NAME, TYPE.NS, 5))!, "home.example.com", []).answers[0]?.type).toBe(TYPE.NS);
  expect(challengeAnswer(readAsk(queryFor(NAME, TYPE.SOA, 5))!, "home.example.com", []).answers[0]?.type).toBe(TYPE.SOA);
  expect(challengeAnswer(readAsk(queryFor(NAME, TYPE.A, 5))!, "home.example.com", ["x"]).answers).toEqual([]);
  expect(txtData("x".repeat(300)).length).toBe(302);
});

test("coveredBy: a wildcard covers its domain and one label under it", () => {
  expect(coveredBy(["*.home.example.com"], "home.example.com")).toBe(true);
  expect(coveredBy(["*.home.example.com"], "web.home.example.com")).toBe(true);
  expect(coveredBy(["*.home.example.com"], "a.b.home.example.com")).toBe(false);
  expect(coveredBy(["*.home.example.com"], "example.com")).toBe(false);
  expect(coveredBy(["web.example.com"], "web.example.com")).toBe(true);
});

test("certificateRequest: both names go into one request", async () => {
  const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const text = new TextDecoder("latin1").decode(await certificateRequest(["home.example.com", "*.home.example.com"], keys));
  expect(text).toContain("*.home.example.com");
  expect(text.indexOf("home.example.com")).toBeLessThan(text.indexOf("*.home.example.com"));
});

test("the internet gets an answer about the delegated confirmation alone", async () => {
  const { answer, setChallenge } = await import("../src/dnsserver");
  const { settings } = await import("../src/config");
  const before = { https: settings.https, dns: settings.dns };
  settings.https = { ...settings.https, mode: "acme", domain: "home.example.com", wildcard: "delegate" };
  settings.dns = { ...settings.dns, records: [{ name: "printer.lan", type: "A", value: "192.168.1.40" }] };
  try {
    setChallenge(["value"]);
    const code = (p: Uint8Array | null) => p![3]! & 0xf;
    const txt = await answer(queryFor(NAME, TYPE.TXT, 1), "8.8.8.8", "192.168.1.5");
    expect(txtsOf(txt!)).toEqual(["value"]);
    // nothing else, neither of Hata's names nor a question to pass on
    expect(code(await answer(queryFor("printer.lan", TYPE.A, 1), "8.8.8.8", "192.168.1.5"))).toBe(5);
    expect(code(await answer(queryFor("web.home.example.com", TYPE.A, 1), "8.8.8.8", "192.168.1.5"))).toBe(5);
    expect(code(await answer(queryFor("debian.org", TYPE.A, 1), "8.8.8.8", "192.168.1.5"))).toBe(5);
    // on the internet side not even a private asker gets more
    expect(code(await answer(queryFor("printer.lan", TYPE.A, 1), "10.0.0.5", "203.0.113.5", false, true))).toBe(5);
    expect(code(await answer(queryFor("printer.lan", TYPE.A, 1), "192.168.1.9", "192.168.1.5"))).toBe(0);
    // not delegated: the same question from the internet is refused too
    settings.https = { ...settings.https, wildcard: "api" };
    expect(code(await answer(queryFor(NAME, TYPE.TXT, 1), "8.8.8.8", "192.168.1.5"))).toBe(5);
  } finally {
    setChallenge([]);
    Object.assign(settings, before);
  }
});
