import { expect, test } from "bun:test";
import { grantKey, keyOf, listKeys, removeKey, renewTokens, TOKEN_MS, type Grant } from "../src/agents";
import { allowed, backTo, cleanRegistration, declined, findClient, holdQuestion, keepClients, pkceOk, question, readAuthorize, redirectAllowed, redirectMatches, register, resourceMetadata, serverMetadata, spendCode, type Client } from "../src/oauth";

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
// the pair of RFC 7636, appendix B
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

test("where a connector may be sent back to", () => {
  for (const ok of ["https://connector.example/api/mcp/auth_callback", "http://localhost:6274/oauth/callback", "http://127.0.0.1/cb", "http://[::1]:9/cb", "cursor://anysphere.cursor-mcp/oauth/callback"]) expect([ok, redirectAllowed(ok)]).toEqual([ok, true]);
  for (const bad of ["http://example.com/cb", "javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "https://a.example/cb#frag", "https://user:pw@a.example/", "not a url", "", 7, "https://a.example/\nx"]) expect([bad, redirectAllowed(bad)]).toEqual([bad, false]);
});

test("the address must be the registered one; a local program may listen on any port", () => {
  const known = ["https://connector.example/cb", "http://localhost/callback"];
  expect(redirectMatches(known, "https://connector.example/cb")).toBe(true);
  expect(redirectMatches(known, "https://connector.example/cb?x=1")).toBe(false);
  expect(redirectMatches(known, "https://connector.example.evil.example/cb")).toBe(false);
  expect(redirectMatches(known, "http://localhost:51234/callback")).toBe(true);
  expect(redirectMatches(known, "http://localhost:51234/other")).toBe(false);
  expect(redirectMatches(known, "http://127.0.0.1:51234/callback")).toBe(false);
});

test("a registration: public clients, a name without tricks", () => {
  expect(cleanRegistration({ client_name: "Connector\n‮  on the web", redirect_uris: ["https://connector.example/cb"] })).toEqual({ name: "Connector on the web", redirects: ["https://connector.example/cb"] });
  expect(cleanRegistration({ redirect_uris: ["https://a.example/cb"] })).toMatchObject({ name: "MCP client" });
  expect(cleanRegistration({ redirect_uris: [] })).toMatchObject({ error: "invalid_redirect_uri" });
  expect(cleanRegistration({ redirect_uris: ["http://example.com/cb"] })).toMatchObject({ error: "invalid_redirect_uri" });
  expect(cleanRegistration({ redirect_uris: ["https://a.example/cb"], token_endpoint_auth_method: "client_secret_basic" })).toMatchObject({ error: "invalid_client_metadata" });
  expect(cleanRegistration("x")).toMatchObject({ error: "invalid_client_metadata" });
});

test("PKCE", () => {
  expect(pkceOk(VERIFIER, CHALLENGE)).toBe(true);
  expect(pkceOk(VERIFIER + "x", CHALLENGE)).toBe(false);
  expect(pkceOk("short", CHALLENGE)).toBe(false);
  expect(pkceOk(undefined, CHALLENGE)).toBe(false);
});

test("the documents a connector finds its way by", () => {
  expect(resourceMetadata("https://hata.example.com")).toMatchObject({ resource: "https://hata.example.com/mcp", authorization_servers: ["https://hata.example.com"] });
  expect(serverMetadata("https://hata.example.com")).toMatchObject({ issuer: "https://hata.example.com", authorization_endpoint: "https://hata.example.com/oauth/authorize", token_endpoint: "https://hata.example.com/oauth/token", registration_endpoint: "https://hata.example.com/oauth/register", code_challenge_methods_supported: ["S256"] });
});

test("the question of a connector is read: refused on the spot, sent back with an error, or put to the administrator", () => {
  const client: Client = { id: "c1", name: "Connector", redirects: ["https://connector.example/cb"], createdAt: 0, grantedAt: 0 };
  const query = (extra: Record<string, string>) => new URLSearchParams({ response_type: "code", client_id: "c1", redirect_uri: "https://connector.example/cb", code_challenge: CHALLENGE, code_challenge_method: "S256", state: "s1", ...extra });
  expect(readAuthorize(query({}), undefined)).toHaveProperty("refuse");
  expect(readAuthorize(query({ redirect_uri: "https://evil.example/cb" }), client)).toHaveProperty("refuse");
  expect(readAuthorize(query({ response_type: "token" }), client)).toEqual({ back: "https://connector.example/cb?error=unsupported_response_type&error_description=response_type+must+be+%22code%22.&state=s1" });
  expect(readAuthorize(query({ code_challenge_method: "plain" }), client)).toHaveProperty("back");
  expect(readAuthorize(query({ code_challenge: "" }), client)).toHaveProperty("back");
  expect(readAuthorize(query({}), client)).toEqual({ ask: { client: "c1", redirect: "https://connector.example/cb", challenge: CHALLENGE, state: "s1", level: "" } });
  expect(readAuthorize(query({ scope: "operate nonsense", resource: "https://hata.example.com/mcp" }), client)).toMatchObject({ ask: { level: "operate" } });
  expect(readAuthorize(query({ scope: "read operate full" }), client)).toMatchObject({ ask: { level: "" } });
});

test("clients nobody allowed give way first", () => {
  const client = (id: string, createdAt: number, grantedAt = 0): Client => ({ id, name: id, redirects: [], createdAt, grantedAt });
  const day = 24 * 3600_000;
  expect(keepClients([client("old", 0), client("oldGranted", 0, 5), client("new", 2 * day)], 2 * day + 1).map((c) => c.id)).toEqual(["oldGranted", "new"]);
  expect(keepClients([client("a", 1), client("b", 2), client("c", 3, 9)], 10, 2).map((c) => c.id)).toEqual(["c", "b"]);
});

test("from registering to calling: the code is good once, the tokens renew and the old ones stop", () => {
  const reg = register({ client_name: "Connector", redirect_uris: ["https://connector.example/cb"] }) as { client_id: string };
  const client = findClient(reg.client_id)!;
  const read = readAuthorize(new URLSearchParams({ response_type: "code", client_id: client.id, code_challenge: CHALLENGE, code_challenge_method: "S256", state: "xyz" }), client);
  if (!("ask" in read)) throw new Error("not asked");
  const id = holdQuestion(read.ask);
  expect(question(id)).toMatchObject({ name: "Connector", redirect: "https://connector.example/cb" });

  const grant: Grant = { level: "operate", confirm: false, by: "anna" };
  const back = new URL(allowed(id, grant)!);
  expect(back.origin + back.pathname).toBe("https://connector.example/cb");
  expect(back.searchParams.get("state")).toBe("xyz");
  // the question is answered: it cannot be answered again
  expect(question(id)).toBeNull();
  expect(allowed(id, grant)).toBeNull();
  const code = back.searchParams.get("code")!;

  // nothing is made until the connector comes back with the code
  expect(listKeys().some((k) => k.via === "Connector")).toBe(false);
  // without the proof the code gives nothing — and is spent by the try
  expect(spendCode({ code, client: client.id, redirect: undefined, verifier: VERIFIER + "x" })).toBeNull();
  expect(spendCode({ code, client: client.id, redirect: undefined, verifier: VERIFIER })).toBeNull();

  const id2 = holdQuestion(read.ask);
  const code2 = new URL(allowed(id2, grant)!).searchParams.get("code")!;
  expect(spendCode({ code: code2, client: "another", redirect: undefined, verifier: VERIFIER })).toBeNull();
  const id3 = holdQuestion(read.ask);
  const code3 = new URL(allowed(id3, grant)!).searchParams.get("code")!;
  const spent = spendCode({ code: code3, client: client.id, redirect: "https://connector.example/cb", verifier: VERIFIER })!;
  expect(spent).toEqual({ client, grant });

  const bearer = (token: string) => new Request("http://hata/mcp", { headers: { authorization: `Bearer ${token}` } });
  const first = grantKey(spent.client, spent.grant)!;
  expect(first).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "operate" });
  const key = keyOf(bearer(first.access_token))!;
  expect(key.name).toBe("Connector");
  // the token that renews is not a key
  expect(keyOf(bearer(first.refresh_token))).toBeNull();

  expect(renewTokens(first.refresh_token, "another")).toBeNull();
  const second = renewTokens(first.refresh_token, client.id)!;
  expect(keyOf(bearer(first.access_token))).toBeNull();
  expect(keyOf(bearer(second.access_token))?.level).toBe("operate");
  expect(renewTokens(first.refresh_token, client.id)).toBeNull();

  // an hour later the token is no key any more, and the connector gets the next one
  const later = renewTokens(second.refresh_token, client.id, Date.now() - TOKEN_MS - 1)!;
  expect(keyOf(bearer(later.access_token))).toBeNull();

  // the page sees who signed in, and nothing secret
  const shown = listKeys().find((k) => k.id === key.id)!;
  expect(shown).toMatchObject({ name: "Connector", via: "Connector", createdBy: "anna" });
  expect(JSON.stringify(shown)).not.toContain("refresh");

  // a second connector of the same name is told apart
  const twin = keyOf(bearer(grantKey(client, grant)!.access_token))!;
  expect(twin.name).toBe("Connector (2)");
  removeKey(twin.id);

  // removed like any key: its tokens are worth nothing
  const last = renewTokens(later.refresh_token, client.id)!;
  removeKey(key.id);
  expect(keyOf(bearer(last.access_token))).toBeNull();
  expect(renewTokens(last.refresh_token, client.id)).toBeNull();
});

test("declined: the connector is told at its address", () => {
  const reg = register({ redirect_uris: ["http://localhost/cb"] }) as { client_id: string };
  const id = holdQuestion({ client: reg.client_id, redirect: "http://localhost:4000/cb", challenge: CHALLENGE, state: "s", level: "" });
  expect(declined(id)).toBe("http://localhost:4000/cb?error=access_denied&error_description=The+administrator+declined.&state=s");
  expect(declined(id)).toBeNull();
  expect(backTo("cursor://x/cb?a=1", { code: "c", state: "" })).toBe("cursor://x/cb?a=1&code=c");
});
