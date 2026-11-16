import { expect, test } from "bun:test";
import { changedShares, openForWriting } from "../src/smbconf";

const conf = (torrent: string, extra = "") => `# Written by Hata
[global]
   netbios name = test

[Test]
   path = /DATA/Test
   read only = yes

[Time Machine]
   path = /DATA/TimeMachine

[Torrent]
   path = /mnt/500/Torrent
${torrent}
${extra}`;

test("the folders whose rights changed are the ones to close for connected devices", () => {
  const before = conf("   read only = yes");
  expect(changedShares(before, before)).toEqual([]);
  expect(changedShares(before, conf("   read only = no"))).toEqual(["Torrent"]);
  // a folder that is no longer shared is closed too; a new one has nobody connected
  expect(changedShares(conf("   read only = yes", "[Old]\n   path = /x\n"), conf("   read only = yes", "[New]\n   path = /y\n"))).toEqual(["Old"]);
  // a change of the computer's own settings closes nothing
  expect(changedShares(before.replace("netbios name = test", "netbios name = hata"), before)).toEqual([]);
  expect(changedShares(null, before)).toEqual([]);
});

test("files being written over the network folders are told from what smbstatus prints", () => {
  const open = (write: boolean) => ({ opens: { "1/8": { access_mask: { READ_DATA: true, WRITE_DATA: write, APPEND_DATA: false } } } });
  const said = JSON.stringify({
    open_files: {
      "/mnt/d/Films/.": { filename: ".", ...open(true) },
      "/mnt/d/Films/new.mkv": { filename: "new.mkv", ...open(true) },
      "/mnt/d/Films/watched.mkv": { filename: "watched.mkv", ...open(false) },
    },
  });
  expect(openForWriting(said)).toEqual(["/mnt/d/Films/new.mkv"]);
  expect(openForWriting(JSON.stringify({ sessions: {} }))).toEqual([]);
  expect(openForWriting("No locked files")).toEqual([]);
});
