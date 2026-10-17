import { beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { User } from "../src/auth";
import { settings } from "../src/config";
import { grantAt, grantedTo, rightsOf } from "../src/memberfiles";
import type { Share } from "../src/smbconf";

const share = (over: Partial<Share>): Share => ({ name: "Media", path: "/DATA/Media", guest: "none", users: {}, ...over });

test("a user gets what they are given by name, or what anyone gets, whichever is more", () => {
  const shares = [share({ name: "Mine", users: { u1: "write" } }), share({ name: "Read", users: { u1: "read" }, guest: "write" }), share({ name: "Open", guest: "read" }), share({ name: "Theirs", users: { u2: "write" } })];
  expect(grantedTo(shares, { id: "u1" }).map((g) => [g.name, g.access])).toEqual([["Mine", "write"], ["Read", "write"], ["Open", "read"]]);
  // kept out of the network folders: only what anyone gets
  expect(grantedTo(shares, { id: "u1", noShares: true }).map((g) => [g.name, g.access])).toEqual([["Read", "write"], ["Open", "read"]]);
});

test("a path belongs to the innermost shared folder holding it", () => {
  const grants = [{ real: "/DATA/Media", access: "read" }, { real: "/DATA/Media/Photos", access: "write" }];
  expect(grantAt(grants, "/DATA/Media/Photos/a.jpg")?.access).toBe("write");
  expect(grantAt(grants, "/DATA/Media/a.mp3")?.access).toBe("read");
  expect(grantAt(grants, "/DATA/Mediathek")).toBeNull();
  expect(grantAt(grants, "/DATA")).toBeNull();
});

let root = "";
let outside = "";
const user = { id: "u1", name: "olia", role: "member" } as User;
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return "";
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hata-member-"));
  outside = mkdtempSync(join(tmpdir(), "hata-member-out-"));
  mkdirSync(join(root, "Media/Photos"), { recursive: true });
  mkdirSync(join(root, "Docs"), { recursive: true });
  writeFileSync(join(root, "Media/a.txt"), "a");
  writeFileSync(join(outside, "secret"), "s");
  symlinkSync(outside, join(root, "Media/out"));
  symlinkSync(join(root, "Docs"), join(root, "Media/docs"));
  settings.shares = [share({ name: "Media", path: join(root, "Media"), users: { u1: "write" } }), share({ name: "Docs", path: join(root, "Docs"), users: { u1: "read" } })];
});

test("inside a shared folder: read and write as given, never the folder itself", () => {
  const rights = rightsOf(user);
  expect(code(() => rights.need(join(root, "Media/a.txt"), "write"))).toBe("");
  expect(code(() => rights.need(join(root, "Media/new/deeper"), "write"))).toBe("");
  expect(code(() => rights.need(join(root, "Docs"), "read"))).toBe("");
  expect(code(() => rights.need(join(root, "Docs/x"), "write"))).toBe("files.readOnlyShare");
  expect(code(() => rights.need(join(root, "Media"), "write", { entry: true, inner: true }))).toBe("files.shareItself");
  expect(code(() => rights.need(root, "read"))).toBe("files.notShared");
  expect(code(() => rights.need(join(root, "Media/../Docs2"), "read"))).toBe("files.notShared");
});

test("a link is judged by where it leads when opened, by where it lies when acted on", () => {
  const rights = rightsOf(user);
  // out of the shared folders: does not open, as with Samba's `wide links = no`
  expect(code(() => rights.need(join(root, "Media/out/secret"), "read"))).toBe("files.notShared");
  expect(code(() => rights.need(join(root, "Media/out"), "write"))).toBe("files.notShared");
  // into another shared folder: that folder's rights
  expect(code(() => rights.need(join(root, "Media/docs/x"), "write"))).toBe("files.readOnlyShare");
  // the link itself lies in Media: it may be renamed or deleted
  expect(code(() => rights.need(join(root, "Media/out"), "write", { entry: true, inner: true }))).toBe("");
  expect(rights.may(join(root, "Media/out"), "write", true)).toBe(true);
  expect(rights.may(join(root, "Media/out/secret"), "read")).toBe(false);
});

test("folders of machines are kept by machine id, as shares without guests", async () => {
  const { cleanMachineShares } = await import("../src/smbconf");
  expect(cleanMachineShares({ "304015a8": [{ name: "Photos", path: "/srv/photos", guest: "write", users: { u1: "write", u2: "all" } }, { name: "photos", path: "/srv/other", users: {} }], nope: [{ name: "X", path: "/x", users: {} }] })).toEqual({ "304015a8": [{ name: "Photos", path: "/srv/photos", users: { u1: "write" } }] });
  expect(cleanMachineShares([])).toEqual({});
});

test("a machine says where a path really is, and where the entry itself lies", async () => {
  const { real } = await import("../src/clientfiles");
  expect(real({ paths: [join(root, "Media/out/secret"), join(root, "Media/out"), join(root, "Media/new/file")] })).toEqual([
    // inside a link the entry lies where the link leads
    { target: join(outside, "secret"), entry: join(outside, "secret") },
    { target: outside, entry: join(root, "Media/out") },
    { target: join(root, "Media/new/file"), entry: join(root, "Media/new/file") },
  ]);
  expect(() => real({ paths: ["relative"] })).toThrow();
});
