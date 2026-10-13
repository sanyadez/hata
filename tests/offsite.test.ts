import { expect, test } from "bun:test";
import { cleanBucket, cleanTarget, fingerprint, s3Reason, mkdirs, plan, preferredKey, reason } from "../src/offsite";
import { groupKeys, latestFiles, objectKey, parseListings, parseSource, quoted } from "../src/remote";
import { sealedToOpen } from "../src/restore";

const current = { host: "", port: 22, user: "", path: "hata-backups" };

test("the address of the other machine: nothing ssh could read as an option, nothing sftp could read as a pattern", () => {
  expect(cleanTarget({ host: " nas.lan ", port: 2222, user: "backup", path: "/volume1/hata/" }, current)).toEqual({ host: "nas.lan", port: 2222, user: "backup", path: "/volume1/hata" });
  expect(cleanTarget({ host: "fd00::5" }, current)).toMatchObject({ host: "fd00::5" });
  expect(cleanTarget({ path: "copies/my server" }, current)).toMatchObject({ path: "copies/my server" });
  expect(cleanTarget({ host: "-oProxyCommand=x" }, current)).toBe("offsite.badHost");
  expect(cleanTarget({ host: "a b" }, current)).toBe("offsite.badHost");
  expect(cleanTarget({ user: "-l" }, current)).toBe("offsite.badUser");
  expect(cleanTarget({ user: "a@b" }, current)).toBe("offsite.badUser");
  expect(cleanTarget({ port: 0 }, current)).toBe("offsite.badPort");
  expect(cleanTarget({ port: "22" }, current)).toBe("offsite.badPort");
  for (const path of ["", "a/../b", 'a"b', "a*", "a\nrm x", "-x", "a\\b", "a[1]"]) expect(cleanTarget({ path }, current)).toBe("offsite.badPath");
  // only the address comes back, whatever else the current settings carry
  expect(cleanTarget({}, { ...current, passphrase: "kept elsewhere" } as typeof current)).toEqual(current);
  // what was not sent stays
  expect(cleanTarget({}, { ...current, host: "h", user: "u" })).toEqual({ ...current, host: "h", user: "u" });
});

test("the way to a folder is made step by step", () => {
  expect(mkdirs("/volume1/hata")).toEqual(['-mkdir "/volume1"', '-mkdir "/volume1/hata"']);
  expect(mkdirs("copies/my server")).toEqual(['-mkdir "copies"', '-mkdir "copies/my server"']);
});

test("listings are told apart by the commands sftp repeats", () => {
  const output = [
    'sftp> -mkdir "b/memos"',
    'remote mkdir "b/memos": Failure',
    'sftp> -ls -1 "b/memos"',
    "b/memos/20261009-031400.tar.gz.enc",
    "b/memos/20261009-031400.json.enc   ",
    'sftp> -mkdir "b/new"',
    'sftp> -ls -1 "b/new"',
    'sftp> -ls -1 "b/gone"',
    'Can\'t ls: "/home/u/b/gone" not found',
    'sftp> -ls -1 "b/my app"',
    "b/my app/x",
  ].join("\n");
  expect([...parseListings(output)]).toEqual([
    ["b/memos", ["20261009-031400.tar.gz.enc", "20261009-031400.json.enc"]],
    ["b/new", []],
    ["b/gone", []],
    ["b/my app", ["x"]],
  ]);
});

test("what is missing there is sent, the archive before its description", () => {
  expect(plan(["20261009-031400", "20261008-031400"], [])).toEqual({ upload: ["20261008-031400.tar.gz", "20261008-031400.json", "20261009-031400.tar.gz", "20261009-031400.json"], remove: [] });
  // there sealed or plain — it is there
  expect(plan(["20261008-031400", "20261009-031400"], ["20261008-031400.tar.gz.enc", "20261008-031400.json.enc", "20261009-031400.tar.gz", "20261009-031400.json"]).upload).toEqual([]);
  // half-way up is not there
  expect(plan(["20261009-031400"], ["20261009-031400.tar.gz.enc"]).upload).toEqual(["20261009-031400.tar.gz", "20261009-031400.json"]);
});

test("what was deleted here is deleted there — and nothing else", () => {
  const remote = ["20261001-031400.tar.gz.enc", "20261001-031400.json.enc", "20261005-031400.tar.gz", "20261005-031400.json", "20261009-031400.tar.gz", "20261009-031400.json", "20261001-031400.tar.gz.partial", "notes.txt"];
  expect(plan(["20261009-031400"], remote, ["20261001-031400"]).remove).toEqual(["20261001-031400.tar.gz.enc", "20261001-031400.json.enc", "20261001-031400.tar.gz.partial"]);
  // absent here is not deleted here: a new disk, a server restored from its latest snapshots
  expect(plan(["20261009-031400"], remote)).toEqual({ upload: [], remove: [] });
  expect(plan([], remote)).toEqual({ upload: [], remove: [] });
  // deleted and then there again under the same name: it stays
  expect(plan(["20261009-031400"], remote, ["20261009-031400"]).remove).toEqual([]);
});

test("a host key's fingerprint is the one ssh shows", async () => {
  // ssh-keygen -lf on this line prints SHA256:qpHA2xKD5AYsl00ushQZHHSTyLza0EkBvV2jePRqGO0
  const line = "[127.0.0.1]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHiEhdEdevjoM35j2Y30fjUC48uyzUJHsLLVfUBAHdwh";
  expect(await fingerprint(line)).toBe("SHA256:qpHA2xKD5AYsl00ushQZHHSTyLza0EkBvV2jePRqGO0");
  expect(await fingerprint("")).toBe("");
  expect(preferredKey(["h ssh-rsa AAAA", "h ssh-ed25519 BBBB", "h ecdsa-sha2-nistp256 CCCC"])).toBe("h ssh-ed25519 BBBB");
});

test("the reason of a failure is ssh's own line", () => {
  expect(reason('sftp> put "a" "b"\nremote open "b": Permission denied\nConnection closed')).toBe('remote open "b": Permission denied');
  expect(reason("ssh: connect to host nas port 22: Connection refused\nConnection closed")).toBe("ssh: connect to host nas port 22: Connection refused");
  expect(reason("")).toBe("sftp failed");
});

test("of a sealed copy, a restore opens the latest snapshot of each folder", () => {
  const sealed = (id: string) => [`${id}.tar.gz.enc`, `${id}.json.enc`];
  expect(sealedToOpen([...sealed("20261008-031400"), ...sealed("20261009-031400")])).toEqual(["20261009-031400.json.enc", "20261009-031400.tar.gz.enc"]);
  // opened before, or never sealed
  expect(sealedToOpen([...sealed("20261009-031400"), "20261009-031400.tar.gz", "20261009-031400.json"])).toEqual([]);
  expect(sealedToOpen(["20261009-031400.tar.gz", "20261009-031400.json", ...sealed("20261008-031400")])).toEqual([]);
  // one that did not arrive whole is passed over
  expect(sealedToOpen([...sealed("20261008-031400"), "20261009-031400.tar.gz.enc"])).toEqual(["20261008-031400.json.enc", "20261008-031400.tar.gz.enc"]);
  expect(sealedToOpen(["notes.txt"])).toEqual([]);
});

const noBucket = { endpoint: "", region: "us-east-1", bucket: "", prefix: "hata-backups", accessKey: "" };

test("a bucket: an address that is a web address, names the services accept, a folder without a way out", () => {
  expect(cleanBucket({ endpoint: " https://s3.eu-central-003.backblazeb2.com/ ", region: "eu-central-003", bucket: "my-home.backups", prefix: "/hata/server/", accessKey: " 003abc " }, noBucket)).toEqual({ endpoint: "https://s3.eu-central-003.backblazeb2.com", region: "eu-central-003", bucket: "my-home.backups", prefix: "hata/server", accessKey: "003abc" });
  expect(cleanBucket({ endpoint: "http://192.168.1.5:9000", prefix: "" }, noBucket)).toMatchObject({ endpoint: "http://192.168.1.5:9000", prefix: "" });
  // no region typed: the one every service takes
  expect(cleanBucket({ region: "" }, { ...noBucket, region: "auto" })).toMatchObject({ region: "us-east-1" });
  for (const endpoint of ["s3.example.com", "ftp://x", "https://a b", "https://user:pass@host", "https://host/?x=1"]) expect(cleanBucket({ endpoint }, noBucket)).toBe("offsite.badEndpoint");
  for (const bucket of ["", "ab", "My-Bucket", "-bucket", "bucket-", "a/b"]) expect(cleanBucket({ bucket }, noBucket)).toBe("offsite.badBucket");
  for (const prefix of ["a/../b", "a//b", "./a", "a\\b", "a\nb"]) expect(cleanBucket({ prefix }, noBucket)).toBe("offsite.badPath");
  expect(cleanBucket({ region: "EU West" }, noBucket)).toBe("offsite.badRegion");
  expect(cleanBucket({ accessKey: "a b" }, noBucket)).toBe("offsite.badAccessKey");
  expect(cleanBucket({ accessKey: 5 }, noBucket)).toBe("offsite.badAccessKey");
  // the secret is not part of what comes back
  expect(cleanBucket({}, { ...noBucket, secret: "s" } as typeof noBucket)).toEqual(noBucket);
});

test("the files of a bucket are read as the folders of the backup directory", () => {
  expect(objectKey("hata/server", "memos", "20261013-030000.tar.gz")).toBe("hata/server/memos/20261013-030000.tar.gz");
  expect(objectKey("", "memos", "a.json")).toBe("memos/a.json");
  expect(objectKey("hata", "", ".hata-check")).toBe("hata/.hata-check");
  const keys = ["hata/memos/1.tar.gz", "hata/memos/1.json", "hata/_server/2.tar.gz", "hata/.hata-check", "hata/memos/deeper/x", "hatara/memos/3.json", "other/4.json"];
  expect(groupKeys("hata", keys)).toEqual(new Map([["memos", ["1.tar.gz", "1.json"]], ["_server", ["2.tar.gz"]]]));
  expect(groupKeys("", ["memos/1.json", "top.txt"])).toEqual(new Map([["memos", ["1.json"]]]));
});

test("what the storage answered is said with its own code", () => {
  expect(s3Reason({ code: "AccessDenied", message: "Access Denied." })).toBe("AccessDenied: Access Denied.");
  expect(s3Reason({ code: "NoSuchBucket", message: "NoSuchBucket" })).toBe("NoSuchBucket");
  expect(s3Reason(new Error("connection refused"))).toBe("connection refused");
  expect(s3Reason("odd")).toBe("odd");
});

test("where a copy to restore from lies: a bucket, another machine, or a folder here", () => {
  expect(parseSource("/mnt/disk/Backups")).toBeNull();
  expect(parseSource("backups")).toBeNull();
  expect(parseSource("s3://my-home.backups/hata/server/")).toEqual({ kind: "s3", bucket: "my-home.backups", prefix: "hata/server" });
  expect(parseSource("s3://my-home")).toEqual({ kind: "s3", bucket: "my-home", prefix: "" });
  expect(typeof parseSource("s3://My_Bucket/x")).toBe("string");
  expect(typeof parseSource("s3://bucket/a/../b")).toBe("string");
  expect(parseSource("sftp://backup@nas.lan/volume1/hata/")).toEqual({ kind: "sftp", user: "backup", host: "nas.lan", port: 22, path: "/volume1/hata" });
  expect(parseSource("sftp://u@[fd00::5]:2222/~/copies/my server")).toEqual({ kind: "sftp", user: "u", host: "fd00::5", port: 2222, path: "copies/my server" });
  for (const bad of ["sftp://nas.lan/x", "sftp://u@nas.lan", "sftp://u@nas.lan/", "sftp://-oProxyCommand=x@h/p", "sftp://u@-h/p", 'sftp://u@h/a"b', "sftp://u@h/a/../b", "sftp://u@h/~/-x", "sftp://u@h:99999/p", "sftp://u@h/a*"]) expect([bad, typeof parseSource(bad)]).toEqual([bad, "string"]);
});

test("a restore fetches the two files of the latest whole snapshot of a folder", () => {
  expect(latestFiles(["20261010-030000.tar.gz", "20261010-030000.json", "20261012-030000.tar.gz", "20261012-030000.json", "notes.txt"])).toEqual(["20261012-030000.json", "20261012-030000.tar.gz"]);
  // the newest is half there: the one before it is whole
  expect(latestFiles(["20261010-030000.tar.gz.enc", "20261010-030000.json.enc", "20261012-030000.tar.gz.enc"])).toEqual(["20261010-030000.json.enc", "20261010-030000.tar.gz.enc"]);
  expect(latestFiles(["20261010-030000.tar.gz.partial", "20261010-030000.json"])).toEqual([]);
  expect(latestFiles([])).toEqual([]);
  expect(quoted("a b")).toBe('"a b"');
});
