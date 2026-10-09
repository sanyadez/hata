import { expect, test } from "bun:test";
import {
  beginTotp,
  changePassword,
  checkPassword,
  checkSecondFactor,
  completeSetup,
  createSession,
  createUser,
  deleteUser,
  destroySession,
  disableTotp,
  enableTotp,
  findUser,
  listSessions,
  listUsers,
  loginBlockedFor,
  needsSetup,
  recoveryCodesLeft,
  registerLoginFailure,
  revokeSession,
  sessionCookie,
  sessionUser,
  setupToken,
  updateUser,
} from "../src/auth";
import { stepAt, totp } from "../src/totp";

const client = { ip: "192.0.2.1", userAgent: "test browser" };
const signIn = (user: Parameters<typeof createSession>[0]) => {
  const cookie = sessionCookie(createSession(user, client), false).split(";")[0]!;
  return request(cookie);
};

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

  const token = createSession(user!, client);
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

test("users: create, roles, the last administrator is protected", async () => {
  const admin = (await checkPassword("admin", "long enough"))!;
  expect(await createUser("admin", "long enough 2", "member")).toBe("users.nameTaken");
  expect(await createUser("anna", "short", "member")).toBe("auth.weakPassword");
  expect(await createUser("anna", "long enough 2", "owner")).toBe("users.badRole");
  const anna = await createUser("anna", "long enough 2", "member");
  expect(typeof anna).toBe("object");
  if (typeof anna === "string") return;
  expect(listUsers().map((u) => [u.name, u.role, u.twoFactor])).toEqual([["admin", "admin", false], ["anna", "member", false]]);

  expect(await updateUser(admin.id, { role: "member" })).toBe("users.lastAdmin");
  expect(deleteUser(admin.id, admin)).toBe("users.self");
  expect(await updateUser(anna.id, { role: "admin" })).toBeNull();
  expect(await updateUser(admin.id, { role: "member" })).toBeNull();
  expect(deleteUser(anna.id, admin)).toBe("users.lastAdmin");
  expect(await updateUser(admin.id, { role: "admin" })).toBeNull();
  expect(await updateUser("nobody", { role: "admin" })).toBe("users.notFound");

  // a password set by an administrator signs the user out everywhere
  const annaRequest = signIn(anna);
  expect(sessionUser(annaRequest)?.name).toBe("anna");
  expect(await updateUser(anna.id, { password: "another long one" })).toBeNull();
  expect(sessionUser(annaRequest)).toBeNull();
  expect((await checkPassword("anna", "another long one"))?.id).toBe(anna.id);

  const again = signIn(anna);
  expect(deleteUser(anna.id, admin)).toBeNull();
  expect(sessionUser(again)).toBeNull();
  expect(findUser(anna.id)).toBeNull();
});

test("own password and sessions", async () => {
  const admin = (await checkPassword("admin", "long enough"))!;
  const here = signIn(admin);
  const there = signIn(admin);
  const list = listSessions(admin, here);
  expect(list.length).toBe(2);
  expect(list[0]).toMatchObject({ current: true, ip: "192.0.2.1", userAgent: "test browser" });

  expect(revokeSession(admin, "no-such-id")).toBe(false);
  expect(revokeSession(admin, list[1]!.id)).toBe(true);
  expect(sessionUser(there)).toBeNull();
  expect(sessionUser(here)?.id).toBe(admin.id);

  const other = signIn(admin);
  expect(await changePassword(admin, "wrong", "brand new password", here)).toBe("auth.wrongPassword");
  expect(await changePassword(admin, "long enough", "short", here)).toBe("auth.weakPassword");
  expect(await changePassword(admin, "long enough", "brand new password", here)).toBeNull();
  // this browser stays signed in, the others do not
  expect(sessionUser(here)?.id).toBe(admin.id);
  expect(sessionUser(other)).toBeNull();
  expect(await checkPassword("admin", "long enough")).toBeNull();
  expect(await changePassword(admin, "brand new password", "long enough", here)).toBeNull();
});

test("two-factor sign-in: setup, codes work once, recovery codes, switching off", async () => {
  const admin = (await checkPassword("admin", "long enough"))!;
  expect(enableTotp(admin, "123456")).toBe("totp.notStarted");
  const { secret, uri } = beginTotp(admin);
  expect(uri).toContain(`secret=${secret}`);
  expect(enableTotp(admin, "000000")).toBe("totp.wrongCode");
  expect(admin.totp).toBeUndefined();

  const now = stepAt(Date.now());
  const codes = enableTotp(admin, totp(secret, now));
  expect(Array.isArray(codes)).toBe(true);
  expect((codes as string[]).length).toBe(8);
  expect(listUsers()[0]!.twoFactor).toBe(true);

  // the code that confirmed the setup is spent; the next step's code works, and only once
  expect(checkSecondFactor(admin, totp(secret, now))).toBe(false);
  expect(checkSecondFactor(admin, totp(secret, now + 1))).toBe(true);
  expect(checkSecondFactor(admin, totp(secret, now + 1))).toBe(false);
  expect(checkSecondFactor(admin, "000000")).toBe(false);

  const recovery = (codes as string[])[0]!;
  expect(checkSecondFactor(admin, recovery.toUpperCase())).toBe(true);
  expect(checkSecondFactor(admin, recovery)).toBe(false);
  expect(recoveryCodesLeft(admin)).toBe(7);

  expect(await disableTotp(admin, "wrong")).toBe("auth.wrongPassword");
  expect(await disableTotp(admin, "long enough")).toBeNull();
  expect(admin.totp).toBeUndefined();
  expect(checkSecondFactor(admin, totp(secret, now + 1))).toBe(false);
});

test("a member may look, not touch", async () => {
  const { memberMay } = await import("../src/server");
  const yes: [string, string][] = [["GET", "/api/overview"], ["GET", "/api/apps"], ["GET", "/api/apps/memos"], ["GET", "/api/apps/memos/stats"], ["GET", "/api/store"], ["GET", "/api/store/casaos/apps/jellyfin"], ["GET", "/api/events"], ["POST", "/api/logout"], ["POST", "/api/account/password"], ["GET", "/api/account"]];
  const no: [string, string][] = [["POST", "/api/apps"], ["DELETE", "/api/apps/memos"], ["POST", "/api/apps/memos/stop"], ["GET", "/api/apps/memos/logs"], ["GET", "/api/apps/memos/compose"], ["GET", "/api/apps/memos/backups"], ["GET", "/api/settings"], ["PUT", "/api/settings"], ["GET", "/api/users"], ["POST", "/api/users"], ["GET", "/api/backups"], ["GET", "/api/activity"], ["GET", "/api/jobs/00000000-0000-0000-0000-000000000000"], ["POST", "/api/store/casaos/sync"]];
  for (const [method, path] of yes) expect([method, path, memberMay(method, path)]).toEqual([method, path, true]);
  for (const [method, path] of no) expect([method, path, memberMay(method, path)]).toEqual([method, path, false]);
  // a guest is a shared account: it opens its apps and nothing else
  expect(memberMay("GET", "/api/overview", "guest")).toBe(true);
  expect(memberMay("GET", "/api/account", "guest")).toBe(true);
  expect(memberMay("POST", "/api/account/password", "guest")).toBe(false);
  expect(memberMay("POST", "/api/account/totp/begin", "guest")).toBe(false);
  expect(memberMay("GET", "/api/store", "guest")).toBe(false);
});

test("invitations are single-use links for members and guests", async () => {
  const { createInvite, acceptInvite, inviteInfo, listInvites, revokeInvite } = await import("../src/auth");
  const admin = (await checkPassword("admin", "long enough"))!;
  expect(createInvite("admin", "", admin)).toBe("users.badRole");
  const invite = createInvite("guest", "living room TV", admin);
  if (typeof invite === "string") throw new Error(invite);
  expect(inviteInfo(invite.token)).toEqual({ role: "guest" });
  expect(inviteInfo("wrong")).toBeNull();
  expect(listInvites().map((i) => [i.role, i.note, i.createdBy])).toEqual([["guest", "living room TV", "admin"]]);
  expect(JSON.stringify(listInvites())).not.toContain(invite.token);

  expect(await acceptInvite(invite.token, "admin", "long enough 3")).toBe("users.nameTaken");
  expect(await acceptInvite(invite.token, "tv", "short")).toBe("auth.weakPassword");
  const user = await acceptInvite(invite.token, "tv", "long enough 3");
  expect(typeof user === "object" && user.role).toBe("guest");
  expect(await acceptInvite(invite.token, "tv2", "long enough 3")).toBe("invite.invalid");
  expect(listInvites()).toEqual([]);

  const second = createInvite("member", "", admin);
  if (typeof second === "string") throw new Error(second);
  expect(revokeInvite(second.id)).toBe(true);
  expect(inviteInfo(second.token)).toBeNull();
  if (typeof user === "object") deleteUser(user.id, admin);
});
