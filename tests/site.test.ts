import { afterAll, expect, test } from "bun:test";
import { settings } from "../src/config";
import { appHost, appLabel, classifyHost, cookieDomain, requestProto, siteDomain } from "../src/site";

const req = (headers: Record<string, string> = {}) => new Request("http://10.0.0.5/", { headers });
afterAll(() => {
  settings.https = { mode: "off", domain: "", email: "" };
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
