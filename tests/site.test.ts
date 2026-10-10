import { afterAll, expect, test } from "bun:test";
import { localName, settings } from "../src/config";
import { appHost, appLabel, classifyHost, cookieDomain, domainOf, localDomain, requestPort, requestProto, siteDomain } from "../src/site";

const req = (headers: Record<string, string> = {}) => new Request("http://10.0.0.5/", { headers });
afterAll(() => {
  settings.https = { mode: "off", domain: "", email: "" };
  settings.local = { enabled: true, name: "hata.local" };
});

test("without a domain everything is Hata and cookies are host-only", () => {
  settings.https = { mode: "off", domain: "home.example.com", email: "" };
  expect(siteDomain()).toBe("");
  expect(classifyHost("memos.home.example.com")).toEqual({ kind: "hata" });
  expect(cookieDomain("home.example.com")).toBeUndefined();
  // a header anyone can send is not believed when there is no proxy
  expect(requestProto(req({ "x-forwarded-proto": "https" }))).toBe("http");
});

test("with a domain, one label under it is an app", () => {
  settings.https = { mode: "proxy", domain: "home.example.com", email: "" };
  expect(classifyHost("home.example.com")).toEqual({ kind: "hata" });
  expect(classifyHost("memos.home.example.com")).toEqual({ kind: "app", label: "memos" });
  expect(classifyHost("a.b.home.example.com")).toEqual({ kind: "hata" });
  expect(classifyHost("evilhome.example.com")).toEqual({ kind: "hata" });
  expect(classifyHost("192.168.1.20")).toEqual({ kind: "hata" });
  expect(appLabel("big_bear_app")).toBe("big-bear-app");
  expect(appHost("big_bear_app")).toBe("big-bear-app.home.example.com");
  expect(cookieDomain("home.example.com")).toBe("home.example.com");
  expect(cookieDomain("memos.home.example.com")).toBe("home.example.com");
  // reached by address: the cookie stays with that address
  expect(cookieDomain("192.168.1.20")).toBeUndefined();
  expect(requestProto(req({ "x-forwarded-proto": "https" }))).toBe("https");
  expect(requestProto(req())).toBe("http");
});

test("the name on the home network is a domain too, next to the one that is set", () => {
  settings.https = { mode: "acme", domain: "home.example.com", email: "" };
  settings.local = { enabled: true, name: "attic.local" };
  expect(localDomain()).toBe("attic.local");
  expect(classifyHost("attic.local")).toEqual({ kind: "hata" });
  expect(classifyHost("memos.attic.local")).toEqual({ kind: "app", label: "memos" });
  expect(classifyHost("a.b.attic.local")).toEqual({ kind: "hata" });
  expect(cookieDomain("memos.attic.local")).toBe("attic.local");
  expect(domainOf("memos.home.example.com")).toBe("home.example.com");
  expect(domainOf("hata.local")).toBe("");
  expect(requestPort(req({ host: "memos.attic.local:8080" }))).toBe(":8080");
  expect(requestPort(req({ host: "memos.attic.local" }))).toBe("");
  // switched off, the name means nothing
  // any other ending is as good, when the home's DNS knows the name
  settings.local = { enabled: true, name: "hata.lan" };
  expect(classifyHost("memos.hata.lan")).toEqual({ kind: "app", label: "memos" });
  expect(cookieDomain("hata.lan")).toBe("hata.lan");
  expect(classifyHost("memos.attic.local")).toEqual({ kind: "hata" });
  settings.local = { enabled: false, name: "attic.local" };
  expect(localDomain()).toBe("");
  expect(classifyHost("memos.attic.local")).toEqual({ kind: "hata" });
  expect(cookieDomain("attic.local")).toBeUndefined();
});

test("a single word is a name ending in .local; a whole name is kept as it is", () => {
  expect(["hata", " Attic ", "hata.local", "hata.lan", "nas.home.arpa.", "my-server.internal"].map(localName)).toEqual(["hata.local", "attic.local", "hata.local", "hata.lan", "nas.home.arpa", "my-server.internal"]);
  expect(["", "bad name", "-hata", "hata..lan", "hata.1", "a_b.lan", 5, null].map(localName)).toEqual([null, null, null, null, null, null, null, null]);
});
