import { expect, test } from "bun:test";
import { findUses, type World } from "../src/diskuses";

const world: World = {
  apps: [
    { name: "qbittorrent", title: "qBittorrent", running: true, folders: ["/DATA/AppData/qbittorrent/config", "/mnt/500/Torrent"] },
    { name: "memos", title: "Memos", running: true, folders: ["/DATA/AppData/memos"] },
    { name: "jellyfin", title: "Jellyfin", running: false, folders: ["/mnt/500/Torrent/Films"] },
  ],
  tvPlaying: "/mnt/500/Torrent/film.mkv",
  tvFolders: ["/mnt/500/Torrent", "/DATA/Media"],
  music: ["/DATA/Media/Music/a.mp3", "/mnt/500/Music/b.flac"],
  pins: ["/mnt/500", "/mnt/5000/other"],
  favorites: ["/mnt/500/Torrent", "/mnt/500/Torrent", "/DATA/x"],
  shares: [{ name: "Films", path: "/mnt/500/Torrent" }, { name: "Docs", path: "/DATA/Docs" }],
};

test("what stands on a folder that is being disconnected", () => {
  const uses = findUses("/mnt/500", world);
  expect(uses.map((use) => [use.kind, use.name, use.running])).toEqual([
    ["app", "qBittorrent", true],
    ["app", "Jellyfin", false],
    ["tvPlaying", "film.mkv", undefined],
    ["musicPlaying", "b.flac", undefined],
    ["tvFolder", "Torrent", undefined],
    ["share", "Films", undefined],
    ["pin", "500", undefined],
    ["favorite", "Torrent", undefined],
  ]);
  // a folder whose name merely begins the same is another folder
  expect(findUses("/mnt/5000", world).map((use) => use.kind)).toEqual(["pin"]);
  expect(findUses("/mnt/usb-stick", world)).toEqual([]);
});
