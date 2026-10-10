import { beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DATA_DIR, settings } from "../src/config";
import { archivePlan, emptyTrash, freeName, list, mustBeSharable, onSharesMoved, pinFolder, pinnedFolders, locate, makeFolder, readable, readText, remove, rename, restore, summary, transfer, trash, upload, validName, writeText, type UploadPart } from "../src/files";
import { world } from "../src/trash";
import { zipChunks } from "../src/zip";

let root = "";
let outside = "";

beforeEach(() => {
  world.remembered.clear();
  root = mkdtempSync(join(tmpdir(), "hata-files-"));
  outside = mkdtempSync(join(tmpdir(), "hata-outside-"));
  settings.dataRoot = root;
  mkdirSync(join(root, "Media/Photos"), { recursive: true });
  mkdirSync(join(root, "AppData/memos"), { recursive: true });
  writeFileSync(join(root, "Media/a.txt"), "hello");
  writeFileSync(join(outside, "secret"), "secret");
});

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return "";
};
const rejects = async (promise: Promise<unknown>) => promise.then(() => "", (e: Error) => e.message);
const stream = (text: string) => new Blob([text]).stream() as ReadableStream<Uint8Array>;
const part = (over: Partial<UploadPart>): UploadPart => ({ dir: join(root, "Media"), name: "up.bin", sub: "", id: "abcdefgh", offset: 0, last: true, overwrite: false, ...over });

const at = (path: string) => join(root, path);

test("a path is absolute and tidied", () => {
  expect(locate("/")).toBe("/");
  expect(locate("/a//b/../c/")).toBe("/a/c");
  for (const bad of ["", "Media", "./x", "/a\0b", null, 7]) expect(code(() => locate(bad))).toBe("files.badPath");
});

test("a link is followed, and removing it leaves its target", async () => {
  symlinkSync(outside, at("/Media/out"));
  symlinkSync(at("/Media/gone"), at("/Media/broken"));
  expect(readable(at("/Media/out/secret")).size).toBe(6);
  const entries = Object.fromEntries((await list(at("/Media"))).entries.map((e) => [e.name, e]));
  expect(entries.out).toMatchObject({ type: "dir", link: true });
  expect(entries.broken).toMatchObject({ type: "other", link: true });
  await remove([at("/Media/out"), at("/Media/broken")]);
  expect(existsSync(at("/Media/out"))).toBe(false);
  expect(readFileSync(join(outside, "secret"), "utf8")).toBe("secret");
});

test("Hata's own state can be looked at, not changed — also through a link", async () => {
  writeFileSync(join(DATA_DIR, "probe.json"), "{}");
  expect((await list(DATA_DIR)).readOnly).toBe(true);
  expect((await readText(join(DATA_DIR, "probe.json"))).content).toBe("{}");
  symlinkSync(DATA_DIR, at("/Media/state"));
  for (const dir of [DATA_DIR, at("/Media/state")]) {
    expect(await rejects(writeText(join(dir, "probe.json"), "x", undefined))).toBe("files.protected");
    expect(code(() => makeFolder(dir, "x"))).toBe("files.protected");
    expect(await rejects(upload(part({ dir }), stream("x")))).toBe("files.protected");
    expect(await rejects(remove([join(dir, "probe.json")]))).toBe("files.protected");
    expect(await rejects(transfer([at("/Media/a.txt")], dir, true))).toBe("files.protected");
  }
  expect(await rejects(upload(part({ sub: "state" }), stream("x")))).toBe("files.protected");
  expect(await rejects(remove([DATA_DIR]))).toBe("files.protected");
  expect((await list(at("/Media"))).readOnly).toBe(false);
});

test("the kernel's file systems are listed and nothing more", async () => {
  expect((await list("/proc")).readOnly).toBe(true);
  expect(code(() => readable("/proc/version"))).toBe("files.virtual");
  expect(await rejects(readText("/proc/version"))).toBe("files.virtual");
  expect(await rejects(archivePlan(["/proc/version"]))).toBe("files.virtual");
  expect(await rejects(transfer(["/proc/version"], at("/Media"), true))).toBe("files.virtual");
  expect(code(() => makeFolder("/sys", "x"))).toBe("files.virtual");
});

test("what the server stands on stays where it is", async () => {
  for (const path of ["/", "/etc", "/usr", "/tmp", root, at("/AppData"), process.execPath]) {
    expect(await rejects(remove([path]))).toBe("files.protected");
    expect(code(() => rename(path, "x"))).toBe("files.protected");
    expect(await rejects(transfer([path], at("/Media"), false))).toBe("files.protected");
  }
  // an app's own folder is the user's to remove
  expect(await summary([at("/Media")])).toEqual({ files: 1, dirs: 2, size: 5, truncated: false });
  await remove([at("/AppData/memos"), at("/Media")]);
  expect(readdirSync(root).sort()).toEqual([".hata-trash", "AppData"]);
});

test("names are one path segment", () => {
  expect(validName("  notes.txt ")).toBe("notes.txt");
  for (const bad of ["", " ", ".", "..", "a/b", "a\0", "x".repeat(256), 5]) expect(code(() => validName(bad))).toBe("files.badName");
});

test("a listing: entries, places, no half-uploaded files", async () => {
  writeFileSync(at("/Media/.hata-upload-abcdefgh"), "half");
  const media = await list(at("/Media"));
  expect(media.path).toBe(at("/Media"));
  expect(media.home).toBe(root);
  expect(media.entries.map((e) => e.name).sort()).toEqual(["Photos", "a.txt"]);
  expect(media.entries.find((e) => e.name === "a.txt")).toMatchObject({ type: "file", size: 5 });
  expect(media.places).toEqual(["AppData", "Media"]);
  // without a path — the data root
  expect((await list("")).path).toBe(root);
  expect((await list("/")).entries.some((e) => e.name === "etc")).toBe(true);
  expect(await rejects(list(at("/Media/a.txt")))).toBe("files.notDir");
  expect(await rejects(list(at("/nope")))).toBe("files.notFound");
});

test("folders, renaming, moving and copying never overwrite", async () => {
  expect(makeFolder(at("/Media"), "New")).toBe(at("/Media/New"));
  expect(code(() => makeFolder(at("/Media"), "New"))).toBe("files.exists");
  expect(rename(at("/Media/New"), "Trip")).toBe(at("/Media/Trip"));
  expect(code(() => rename(at("/Media/Trip"), "Photos"))).toBe("files.exists");

  await transfer([at("/Media/a.txt")], at("/Media/Trip"), true);
  expect(readFileSync(at("/Media/Trip/a.txt"), "utf8")).toBe("hello");
  expect(await rejects(transfer([at("/Media/a.txt")], at("/Media/Trip"), false))).toBe("files.exists");
  // a copy next to the original gets a name of its own
  await transfer([at("/Media/a.txt")], at("/Media"), true);
  expect(existsSync(at("/Media/a (2).txt"))).toBe(true);
  expect(await rejects(transfer([at("/Media/a.txt")], at("/Media"), false))).toBe("files.samePlace");
  expect(await rejects(transfer([at("/Media/Trip")], at("/Media/Trip"), true))).toBe("files.intoItself");

  await transfer([at("/Media/a.txt"), at("/Media/a (2).txt")], at("/Media/Photos"), false);
  expect(readdirSync(at("/Media/Photos")).sort()).toEqual(["a (2).txt", "a.txt"]);
  expect(existsSync(at("/Media/a.txt"))).toBe(false);
});

test("a folder on the dashboard follows a rename and a move, and goes with a removal", async () => {
  settings.folders = [];
  pinFolder(at("/Media/Photos"), true);
  pinFolder(at("/Media/Photos"), true);
  expect(code(() => pinFolder(at("/Media/a.txt"), true))).toBe("files.notDir");
  expect((await list(at("/Media"))).pinned).toEqual([at("/Media/Photos")]);
  rename(at("/Media"), "Films");
  expect(pinnedFolders()).toEqual([{ path: at("/Films/Photos"), name: "Photos", missing: false }]);
  await transfer([at("/Films/Photos")], at("/AppData"), false);
  expect(settings.folders).toEqual([at("/AppData/Photos")]);
  pinFolder(at("/Films"), true);
  await remove([at("/AppData/Photos")]);
  expect(settings.folders).toEqual([at("/Films")]);
  pinFolder(at("/Films"), false);
  expect(settings.folders).toEqual([]);
});

test("a shared folder follows a rename and a move, and is not shared once removed", async () => {
  let told = 0;
  onSharesMoved(() => told++);
  mkdirSync(at("/Shared/Docs"), { recursive: true });
  settings.shares = [{ name: "Docs", path: at("/Shared/Docs"), guest: "none", users: { u1: "read" } }];
  expect((await list(at("/Shared"))).shared).toEqual([at("/Shared/Docs")]);
  rename(at("/Shared"), "Given");
  expect(settings.shares).toEqual([{ name: "Docs", path: at("/Given/Docs"), guest: "none", users: { u1: "read" } }]);
  // a name Samba's file cannot hold ends the sharing
  rename(at("/Given/Docs"), "100%");
  expect(settings.shares).toEqual([]);
  settings.shares = [{ name: "Given", path: at("/Given"), guest: "write", users: {} }];
  await remove([at("/Given/100%")]);
  expect(settings.shares.length).toBe(1);
  await remove([at("/Given")]);
  expect(settings.shares).toEqual([]);
  expect(told).toBe(3);
  onSharesMoved(() => {});
});

test("what may be shared: a folder, but not the system's own and not what holds Hata's state", () => {
  mustBeSharable(at("/AppData"));
  expect(code(() => mustBeSharable(at("/nothing")))).toBe("files.notFound");
  for (const path of ["/", "/etc", "/etc/ssh", "/usr/share", "/home", "/proc/1", DATA_DIR, dirname(DATA_DIR)]) expect(code(() => mustBeSharable(path))).toBe("shares.protected");
});

test("the next free name", () => {
  const taken = new Set(["a.txt", "a (2).txt", "dir", ".env"]);
  const has = (name: string) => taken.has(name);
  expect(freeName("", "b.txt", has)).toBe("b.txt");
  expect(freeName("", "a.txt", has)).toBe("a (3).txt");
  expect(freeName("", "dir", has)).toBe("dir (2)");
  expect(freeName("", ".env", has)).toBe(".env (2)");
});

test("a file is uploaded in parts, in order", async () => {
  expect(await upload(part({ last: false }), stream("hello "))).toEqual({ received: 6, path: null });
  expect(existsSync(at("/Media/up.bin"))).toBe(false);
  expect(await rejects(upload(part({ offset: 3 }), stream("x")))).toBe("files.uploadOrder");
  expect(await upload(part({ offset: 6 }), stream("world"))).toEqual({ received: 11, path: at("/Media/up.bin") });
  expect(readFileSync(at("/Media/up.bin"), "utf8")).toBe("hello world");
  expect(readdirSync(at("/Media")).some((name) => name.startsWith(".hata-upload-"))).toBe(false);

  expect(await rejects(upload(part({}), stream("again")))).toBe("files.exists");
  await upload(part({ overwrite: true }), stream("again"));
  expect(readFileSync(at("/Media/up.bin"), "utf8")).toBe("again");
  expect(await rejects(upload(part({ name: "Photos", overwrite: true }), stream("x")))).toBe("files.exists");
  expect(await rejects(upload(part({ id: "../x" }), stream("x")))).toBe("files.badUpload");

  // a folder dropped into the page arrives with its own folders
  expect((await upload(part({ name: "1.jpg", sub: "trip/day 1" }), stream("jpg"))).path).toBe(at("/Media/trip/day 1/1.jpg"));
  expect(await rejects(upload(part({ name: "1.jpg", sub: "../x" }), stream("jpg")))).toBe("files.badName");
  expect((await upload(part({ name: "empty" }), null)).received).toBe(0);
});

test("text is edited only as text, and not over somebody else's change", async () => {
  const file = await readText(at("/Media/a.txt"));
  expect(file.content).toBe("hello");
  expect((await writeText(at("/Media/a.txt"), "hello!", file.modified)).content).toBe("hello!");
  expect(await rejects(writeText(at("/Media/a.txt"), "late", file.modified - 5))).toBe("files.changed");
  writeFileSync(at("/Media/b.bin"), new Uint8Array([0xff, 0xfe, 0x00, 0x01]));
  expect(await rejects(readText(at("/Media/b.bin")))).toBe("files.notText");
  expect(await rejects(readText(at("/Media/Photos")))).toBe("files.notFile");
  expect(readable(at("/Media/a.txt")).inline).toBe("");
  writeFileSync(at("/Media/p.JPG"), "x");
  expect(readable(at("/Media/p.JPG")).inline).toBe("image/jpeg");
});

test("a folder becomes a ZIP archive", async () => {
  writeFileSync(at("/Media/Photos/1.txt"), "one ".repeat(1000));
  symlinkSync(outside, at("/Media/out"));
  const plan = await archivePlan([at("/Media")]);
  expect(plan.name).toBe("Media.zip");
  expect(plan.sources.map((s) => s.name)).toEqual(["Media/", "Media/Photos/", "Media/Photos/1.txt", "Media/a.txt"]);
  // several things are named after the folder they are in
  expect((await archivePlan([at("/Media/a.txt"), at("/Media/Photos")])).name).toBe("Media.zip");
  expect((await archivePlan(["/etc/hostname", "/etc/hosts"])).name).toBe("etc.zip");
  expect((await archivePlan([at("/Media/Photos/1.txt")])).name).toBe("1.txt.zip");

  const chunks: Uint8Array[] = [];
  for await (const chunk of zipChunks(plan.sources)) chunks.push(chunk);
  const zip = Buffer.concat(chunks);
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  const end = zip.subarray(zip.length - 22);
  expect(end.readUInt32LE(0)).toBe(0x06054b50);
  expect(end.readUInt16LE(10)).toBe(4);
  // compressed: 4000 bytes of "one one one" take far less
  expect(zip.length).toBeLessThan(1000);
});

// --- The trash ---

test("what is deleted goes to the trash of the data folder and comes back where it lay", async () => {
  mkdirSync(at("/Media/Photos/2026"), { recursive: true });
  writeFileSync(at("/Media/Photos/2026/one.jpg"), "12345678");
  await remove([at("/Media/Photos"), at("/Media/a.txt")], false, "olena");
  expect(existsSync(at("/Media/Photos"))).toBe(false);
  const { items, size, keepDays } = trash();
  expect(items.map((item) => [item.name, item.from, item.type, item.size, item.files, item.by]).sort()).toEqual([
    ["Photos", at("/Media/Photos"), "dir", 8, 1, "olena"],
    ["a.txt", at("/Media/a.txt"), "file", 5, 1, "olena"],
  ]);
  expect([size, keepDays]).toEqual([13, 30]);
  // the trash is not a folder to walk into, to download or to delete
  expect((await list(root)).entries.map((e) => e.name).sort()).toEqual(["AppData", "Media"]);
  expect((await archivePlan([root])).sources.some((source) => source.name.includes(".hata-trash"))).toBe(false);
  expect(await rejects(remove([at("/.hata-trash")]))).toBe("files.protected");

  const photos = items.find((item) => item.name === "Photos")!;
  expect(restore([photos.id])).toEqual([{ id: photos.id, path: at("/Media/Photos") }]);
  expect(readFileSync(at("/Media/Photos/2026/one.jpg"), "utf8")).toBe("12345678");
  expect(trash().items.map((item) => item.name)).toEqual(["a.txt"]);
  expect(code(() => restore([photos.id]))).toBe("files.notFound");
});

test("a thing comes back even when its folder is gone or its name was taken", async () => {
  writeFileSync(at("/Media/Photos/b.txt"), "old");
  await remove([at("/Media/Photos/b.txt")]);
  await remove([at("/Media/Photos")]);
  writeFileSync(at("/Media/a.txt"), "newer");
  await remove([at("/Media/a.txt")]);
  writeFileSync(at("/Media/a.txt"), "newest");
  const id = (name: string) => trash().items.find((item) => item.name === name)!.id;
  // the folder it lay in is made again
  expect(restore([id("b.txt")])[0]!.path).toBe(at("/Media/Photos/b.txt"));
  // the folder itself is back by now, so the deleted one comes next to it
  expect(restore([id("Photos")])[0]!.path).toBe(at("/Media/Photos (2)"));
  expect(restore([id("a.txt")])[0]!.path).toBe(at("/Media/a (2).txt"));
  expect(readFileSync(at("/Media/a.txt"), "utf8")).toBe("newest");
  expect(trash().items).toEqual([]);
});

test("deleting for good skips the trash; the trash is emptied by entry or whole", async () => {
  writeFileSync(at("/Media/b.txt"), "b");
  writeFileSync(at("/Media/c.txt"), "c");
  await remove([at("/Media/a.txt")], true);
  expect(trash().items).toEqual([]);
  await remove([at("/Media/b.txt"), at("/Media/c.txt"), at("/Media/Photos")]);
  const b = trash().items.find((item) => item.name === "b.txt")!;
  expect(await emptyTrash([b.id])).toBe(1);
  expect(trash().items.map((item) => item.name).sort()).toEqual(["Photos", "c.txt"]);
  expect(await emptyTrash(null)).toBe(2);
  expect(trash().items).toEqual([]);
  expect(readdirSync(at("/.hata-trash"))).toEqual([]);
  expect(await rejects(emptyTrash(["../x"]).then(() => restore("nope")))).toBe("files.badPath");
});
