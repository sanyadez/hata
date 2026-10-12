import { expect, test } from "bun:test";
import { parseCompose } from "../src/appform";
import { cannotMoveData, ownerless } from "../src/movedata";
import { rebaseCompose, rebaseEnv, rebasePath } from "../src/rebase";

test("rebasePath: the folder itself and what lies in it, nothing that only starts alike", () => {
  expect(rebasePath("/DATA", "/DATA", "/mnt/big/DATA")).toBe("/mnt/big/DATA");
  expect(rebasePath("/DATA/AppData/memos", "/DATA", "/mnt/big/DATA")).toBe("/mnt/big/DATA/AppData/memos");
  expect(rebasePath("/DATA2/x", "/DATA", "/mnt/big")).toBeNull();
  expect(rebasePath("/srv/DATA/x", "/DATA", "/mnt/big")).toBeNull();
});

const FILE = `# my notes stay
name: jellyfin
services:
  jellyfin:
    image: jellyfin/jellyfin:10 # pinned
    command: ["--datadir", "/DATA/not-a-volume"]
    environment:
      - CACHE=/DATA/AppData/jellyfin/cache
    volumes:
      - /DATA/AppData/jellyfin/config:/config   # settings
      - "/DATA/Media:/DATA/Media:ro"
      - '/DATA/Media/Films:/films'
      - /etc/localtime:/etc/localtime:ro
      - cache:/cache
      - type: bind
        source: /DATA/AppData/jellyfin/extra
        target: /DATA/extra
      - type: volume
        source: cache
        target: /c2
    ports:
      - 8096:8096
  helper:
    image: busybox
    volumes:
    - /DATA:/all
    - /DATA2/other:/other
volumes:
  cache: {}
x-casaos:
  volumes:
    - container: /config
      description:
        en_us: /DATA/AppData is where it lives
`;

test("rebaseCompose: only the host side of bind mounts moves; comments, quotes and the rest stay", () => {
  const out = rebaseCompose(FILE, "/DATA", "/mnt/big/DATA");
  expect(out).toBe(
    FILE.replace("- /DATA/AppData/jellyfin/config:/config", "- /mnt/big/DATA/AppData/jellyfin/config:/config")
      .replace('"/DATA/Media:/DATA/Media:ro"', '"/mnt/big/DATA/Media:/DATA/Media:ro"')
      .replace("'/DATA/Media/Films:/films'", "'/mnt/big/DATA/Media/Films:/films'")
      .replace("source: /DATA/AppData/jellyfin/extra", "source: /mnt/big/DATA/AppData/jellyfin/extra")
      .replace("- /DATA:/all", "- /mnt/big/DATA:/all"),
  );
  expect(out).toContain("# my notes stay");
  expect(out).toContain('"/DATA/not-a-volume"');
  expect(out).toContain("CACHE=/DATA/AppData/jellyfin/cache");
  expect(out).toContain("target: /DATA/extra");
  expect(out).toContain("- /DATA2/other:/other");
  expect(out).toContain("en_us: /DATA/AppData is where it lives");
});

test("rebaseCompose: a file with nothing in the folder is returned as it is; a second move works on the first", () => {
  const other = "services:\n  a:\n    image: x\n    volumes:\n      - /srv/x:/x\n";
  expect(rebaseCompose(other, "/DATA", "/mnt/big")).toBe(other);
  const once = rebaseCompose(FILE, "/DATA", "/mnt/big/DATA");
  expect(rebaseCompose(once, "/mnt/big/DATA", "/DATA")).toBe(FILE);
});

test("rebaseCompose: volumes written in a way the lines do not show are still moved, through the data", () => {
  const flow = "services:\n  a:\n    image: x\n    volumes: [ /DATA/a:/a, {type: bind, source: /DATA/b, target: /b} ]\n";
  const out = parseCompose(rebaseCompose(flow, "/DATA", "/mnt/big"));
  expect(out.services.a.volumes).toEqual(["/mnt/big/a:/a", { type: "bind", source: "/mnt/big/b", target: "/b" }]);
  const anchored = "x-v: &v\n  - /DATA/a:/a\nservices:\n  a:\n    image: x\n    volumes: *v\n";
  expect(parseCompose(rebaseCompose(anchored, "/DATA", "/mnt/big")).services.a.volumes).toEqual(["/mnt/big/a:/a"]);
});

test("rebaseEnv: values that are paths in the folder move", () => {
  expect(rebaseEnv("# vars\nAppID=x\nMEDIA=/DATA/Media\nQUOTED=\"/DATA/a b\"\nOTHER=/DATA2\nURL=http://x/DATA\n", "/DATA", "/mnt/big")).toBe("# vars\nAppID=x\nMEDIA=/mnt/big/Media\nQUOTED=\"/mnt/big/a b\"\nOTHER=/DATA2\nURL=http://x/DATA\n");
});

test("cannotMoveData: where the folder may go", () => {
  const state = ["/var/lib/hata", "/etc/hata"];
  expect(cannotMoveData("/mnt/big/DATA", "/DATA", state, ["/", "/mnt/big"])).toEqual({ path: "/mnt/big/DATA" });
  expect(cannotMoveData("/mnt/big/", "/DATA", state, [])).toEqual({ path: "/mnt/big" });
  expect(cannotMoveData("/DATA", "/DATA", state, [])).toEqual({ error: "data.samePath" });
  expect(cannotMoveData("/DATA/new", "/DATA", state, [])).toEqual({ error: "data.nested" });
  expect(cannotMoveData("/mnt", "/mnt/big/DATA", state, [])).toEqual({ error: "data.nested" });
  expect(cannotMoveData("relative", "/DATA", state, [])).toEqual({ error: "data.badPath" });
  expect(cannotMoveData("/var/lib/hata/data", "/DATA", state, [])).toEqual({ error: "data.badPath" });
  expect(cannotMoveData("/var/lib", "/DATA", state, [])).toEqual({ error: "data.badPath" });
  expect(cannotMoveData("/mnt/big", "/", state, [])).toEqual({ error: "data.isRoot" });
  // a disk connected inside the folder would be left behind
  expect(cannotMoveData("/mnt/big", "/DATA", state, ["/", "/DATA/Media"])).toEqual({ error: "data.hasMounts", detail: { paths: "/DATA/Media" } });
  // the folder being a disk itself is fine
  expect(cannotMoveData("/mnt/big", "/mnt/old", state, ["/", "/mnt/old"])).toEqual({ path: "/mnt/big" });
});

test("movedDataRoot: the data folder of a snapshot, when it is not the one of now", async () => {
  const { movedDataRoot } = await import("../src/backup");
  const paths = ["/DATA/AppData/writer", "/var/lib/hata/apps/writer", "/var/lib/docker/volumes/writer_cache/_data"];
  expect(movedDataRoot({ paths }, "writer", "/DATA")).toBeNull();
  expect(movedDataRoot({ paths }, "writer", "/mnt/big/DATA")).toBe("/DATA");
  expect(movedDataRoot({ paths, dataRoot: "/DATA" }, "writer", "/mnt/big")).toBe("/DATA");
  // a snapshot that says it wins over what its paths look like
  expect(movedDataRoot({ paths: ["/srv/AppData/x/AppData/y"], dataRoot: "/srv/AppData/x" }, "writer", "/mnt/big")).toBe("/srv/AppData/x");
  // nothing of the data folder in it: nothing to move
  expect(movedDataRoot({ paths: ["/var/lib/hata/apps/writer"] }, "writer", "/mnt/big")).toBeNull();
  // a state folder that itself lies under something called AppData is not the data
  expect(movedDataRoot({ paths: ["/x/AppData/state/apps/writer"] }, "writer", "/mnt/big")).toBeNull();
});

test("ownerless: a disk without owners cannot hold the data folder", () => {
  const mounts = [
    { path: "/", fstype: "ext4" },
    { path: "/mnt/usb", fstype: "exfat" },
    { path: "/mnt/usb/inner", fstype: "ext4" },
    { path: "/mnt/win", fstype: "fuseblk" },
    { path: "/mnt/big", fstype: "ext4" },
  ];
  expect(ownerless("/mnt/big/DATA", mounts)).toBeNull();
  expect(ownerless("/DATA", mounts)).toBeNull();
  expect(ownerless("/mnt/usb/DATA", mounts)).toBe("exfat");
  expect(ownerless("/mnt/usb", mounts)).toBe("exfat");
  expect(ownerless("/mnt/usb/inner/DATA", mounts)).toBeNull();
  expect(ownerless("/mnt/usbstick", mounts)).toBeNull();
  expect(ownerless("/mnt/win/DATA", mounts)).toBe("ntfs");
  expect(ownerless("/DATA", [])).toBeNull();
});
