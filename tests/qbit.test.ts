import { describe, expect, test } from "bun:test";
import { cleanHashes, cleanLinks, isTorrentFile, isWebApiVersion, readTorrent, sessionCookie, totalsOf, trouble, verbsOf } from "../src/qbit";

const HASH = "a".repeat(40);

describe("reading qBittorrent", () => {
  test("a torrent, with both names of a paused one", () => {
    const t = readTorrent({ hash: HASH, name: "x", state: "stalledDL", progress: 0.5678, size: 100, dlspeed: 0, upspeed: 3, eta: 8640000, ratio: 1.234, added_on: 10, save_path: "/DATA" });
    expect(t).toEqual({ hash: HASH, name: "x", group: "downloading", waiting: true, percent: 56.8, size: 100, down: 0, up: 3, eta: null, ratio: 1.23, added: 10000, path: "/DATA" });
    expect(readTorrent({ state: "pausedDL" }).group).toBe("paused");
    expect(readTorrent({ state: "stoppedDL" }).group).toBe("paused");
    expect(readTorrent({ state: "stoppedUP" }).group).toBe("finished");
    expect(readTorrent({ state: "missingFiles" }).group).toBe("error");
    expect(readTorrent({ state: "checkingResumeData" }).group).toBe("checking");
  });

  test("a state of a future version is shown as downloading, nothing breaks", () => {
    expect(readTorrent({ state: "somethingNew", progress: 2, size: -1 })).toMatchObject({ group: "downloading", percent: 100, size: 0 });
  });

  test("totals", () => {
    const list = [{ state: "downloading", dlspeed: 5 }, { state: "stalledUP" }, { state: "uploading", upspeed: 7 }, { state: "stoppedUP" }, { state: "error" }].map(readTorrent);
    expect(totalsOf(list)).toEqual({ total: 5, active: 2, downloading: 1, seeding: 2, paused: 1, errors: 1, down: 5, up: 7 });
  });

  test("the session's cookie under both names", () => {
    expect(sessionCookie(["SID=abc; HttpOnly; path=/"])).toBe("SID=abc");
    expect(sessionCookie(["other=1", "QBT_SID_8080=xyz; HttpOnly"])).toBe("QBT_SID_8080=xyz");
    expect(sessionCookie(["adminer_sid=1"])).toBe("");
  });

  test("the words for pausing follow the Web API's version", () => {
    expect(verbsOf("2.8.3")).toEqual({ pause: "pause", resume: "resume" });
    expect(verbsOf("2.11.0")).toEqual({ pause: "stop", resume: "start" });
    expect(verbsOf("3.0")).toEqual({ pause: "stop", resume: "start" });
  });

  test("whatever else answers on the port is not a version", () => {
    expect(isWebApiVersion("2.11.4\n")).toBe(true);
    expect(isWebApiVersion("<!DOCTYPE html>")).toBe(false);
    expect(isWebApiVersion("")).toBe(false);
  });
});

describe("what is given to it", () => {
  test("hashes", () => {
    expect(cleanHashes([HASH.toUpperCase()])).toEqual([HASH]);
    expect(cleanHashes(["all"])).toBeNull();
    expect(cleanHashes([`${HASH}|${HASH}`])).toBeNull();
    expect(cleanHashes([])).toBeNull();
    expect(cleanHashes(HASH)).toBeNull();
  });

  test("links, one a line", () => {
    expect(cleanLinks(`magnet:?xt=urn:btih:${HASH}\n\n https://example.org/a.torrent \r\n${HASH}`)).toEqual([`magnet:?xt=urn:btih:${HASH}`, "https://example.org/a.torrent", HASH]);
    expect(cleanLinks("file:///etc/passwd")).toBeNull();
    expect(cleanLinks("magnet:?a=b\njavascript:x")).toBeNull();
    expect(cleanLinks("   ")).toBeNull();
    expect(cleanLinks(Array(51).fill(HASH).join("\n"))).toBeNull();
  });

  test("a torrent file by its content", () => {
    expect(isTorrentFile(Buffer.from("d8:announce3:abc4:infod4:name1:xee"))).toBe(true);
    expect(isTorrentFile(Buffer.from("<html>not a torrent at all</html>"))).toBe(false);
    expect(isTorrentFile(Buffer.alloc(2 * 1024 * 1024, 0x64))).toBe(false);
  });
});

describe("what needs attention", () => {
  const base = { id: "1", name: "Q", error: null, ready: true, failed: [] as string[] };
  test("a refused sign-in at once, silence after five minutes", () => {
    expect(trouble({ ...base, error: { code: "qbit.badLogin", since: 0 } }, 1)[0]).toMatchObject({ severity: "danger", code: "qbit.badLogin" });
    expect(trouble({ ...base, error: { code: "qbit.noAnswer", since: 0 } }, 60_000)).toEqual([]);
    expect(trouble({ ...base, error: { code: "qbit.noAnswer", since: 0 } }, 6 * 60_000)[0]).toMatchObject({ severity: "warn", code: "qbit.away" });
  });
  test("torrents in error, nothing before the first answer", () => {
    expect(trouble({ ...base, failed: ["a", "b"] })[0]).toMatchObject({ code: "qbit.errors", detail: { n: 2, torrent: "a" } });
    expect(trouble({ ...base, ready: false, failed: ["a"] })).toEqual([]);
    expect(trouble(base)).toEqual([]);
  });
});
