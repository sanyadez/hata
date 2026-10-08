import { expect, test } from "bun:test";
import { checkPassword, completeSetup, createSession, destroySession, loginBlockedFor, needsSetup, registerLoginFailure, sessionCookie, sessionUser, setupToken } from "../src/auth";

const request = (cookie?: string) => new Request("http://hata/", { headers: cookie ? { cookie } : {} });

test("setup needs the token, then never works again", async () => {
  expect(needsSetup()).toBe(true);
  const token = setupToken()!;
  expect(token).toMatch(/^[0-9a-f]{32}$/);
  expect(setupToken()).toBe(token);

  expect(await completeSetup("wrong", "admin", "long enough")).toBe("setup.badToken");
  expect(await completeSetup(token, "bad name!", "long enough")).toBe("auth.badName");
  expect(await completeSetup(token, "admin", "short")).toBe("auth.weakPassword");
  expect(needsSetup()).toBe(true);

  const user = await completeSetup(token, "admin", "long enough");
  expect(typeof user).toBe("object");
  expect(needsSetup()).toBe(false);
  expect(setupToken()).toBeNull();
  expect(await completeSetup(token, "second", "long enough")).toBe("setup.done");
});

test("password check and sessions", async () => {
  expect(await checkPassword("admin", "wrong password")).toBeNull();
  expect(await checkPassword("nobody", "long enough")).toBeNull();
  const user = await checkPassword("Admin", "long enough");
  expect(user?.name).toBe("admin");

  const token = createSession(user!);
  const cookie = sessionCookie(token, false).split(";")[0]!;
  expect(sessionUser(request(cookie))?.id).toBe(user!.id);
  expect(sessionUser(request())).toBeNull();
  expect(sessionUser(request("hata_session=" + "0".repeat(64)))).toBeNull();
  expect(sessionCookie(token, true)).toContain("Secure");

  destroySession(request(cookie));
  expect(sessionUser(request(cookie))).toBeNull();
});

test("repeated failures lock the address out", () => {
  const ip = "203.0.113.7";
  for (let i = 0; i < 4; i++) registerLoginFailure(ip);
  expect(loginBlockedFor(ip)).toBe(0);
  registerLoginFailure(ip);
  expect(loginBlockedFor(ip)).toBeGreaterThan(0);
  expect(loginBlockedFor("203.0.113.8")).toBe(0);
});
