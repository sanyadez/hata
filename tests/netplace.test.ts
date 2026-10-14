import { expect, test } from "bun:test";
import { announcement, parseQuery } from "../src/mdns";
import { browseQuery, cleanPlace, credentials, foundServers, freeSlug, mountUnit, parseAnswer, parseExports, parseSmbShares, quoteArg, rcloneSection, rcloneUnit, shown, slugOf, unitOf, unitPath, type Place } from "../src/netplace";

const owner = { uid: 1000, gid: 1000 };
const smb = (extra: Record<string, unknown> = {}) => cleanPlace({ kind: "smb", name: "NAS фото", host: "nas.local", path: "photos/2024", user: "me", password: "p w", ...extra }, null, [], "a1", 5) as Place;

test("a folder name from any words, never one that is taken", () => {
  expect(slugOf("NAS фото")).toBe("nas");
  expect(slugOf("Café Música!")).toBe("cafe-musica");
  expect(slugOf("Фото")).toBe("");
  expect(freeSlug("nas", ["nas", "nas-2"])).toBe("nas-3");
  expect(freeSlug("", [])).toBe("place");
});

test("what the page sends is checked per kind", () => {
  expect(cleanPlace({ kind: "zip" }, null, [], "x", 0)).toBe("netplace.badKind");
  expect(cleanPlace({ kind: "smb", name: "x", host: "nas", path: "" }, null, [], "x", 0)).toBe("netplace.badShare");
  expect(cleanPlace({ kind: "smb", name: "x", host: "-oops", path: "a" }, null, [], "x", 0)).toBe("netplace.badHost");
  expect(cleanPlace({ kind: "smb", name: "x", host: "nas", path: "a,uid=0" }, null, [], "x", 0)).toBe("netplace.badShare");
  expect(cleanPlace({ kind: "smb", name: "x", host: "nas", path: "a", user: "me,uid=0" }, null, [], "x", 0)).toBe("netplace.badText");
  expect(cleanPlace({ kind: "nfs", name: "x", host: "nas", path: "export" }, null, [], "x", 0)).toBe("netplace.badExport");
  expect(cleanPlace({ kind: "webdav", name: "x", url: "ftp://a" }, null, [], "x", 0)).toBe("netplace.badUrl");
  expect(cleanPlace({ kind: "webdav", name: "x", url: "https://me:pw@a" }, null, [], "x", 0)).toBe("netplace.badUrl");
  expect(cleanPlace({ kind: "sftp", name: "x", host: "box", path: "../etc" }, null, [], "x", 0)).toBe("netplace.badPath");
  expect(cleanPlace({ kind: "sftp", name: "x", host: "box", password: "a\nb" }, null, [], "x", 0)).toBe("netplace.badText");
  expect(cleanPlace({ kind: "ftp", name: "x", host: "box", port: 70000 }, null, [], "x", 0)).toBe("netplace.badPort");
  const place = smb();
  expect(place).toMatchObject({ id: "a1", slug: "nas", kind: "smb", host: "nas.local", path: "photos/2024", password: "p w", created: 5 });
  // a change keeps the folder and, with an empty field, the password
  const changed = cleanPlace({ host: "10.0.0.2", password: "" }, place, ["nas"], "b2", 9) as Place;
  expect(changed).toMatchObject({ id: "a1", slug: "nas", host: "10.0.0.2", password: "p w", created: 5 });
  expect(shown(place)).toMatchObject({ password: "", passwordSet: true });
  // without a slash: from the user's own folder on the server
  expect((cleanPlace({ kind: "sftp", name: "Box", host: "box", path: "srv/media" }, null, [], "c", 0) as Place).path).toBe("srv/media");
});

test("the kernel's units: names as systemd makes them, sign-in in a file of its own", () => {
  expect(unitPath("/mnt/net/nas-photos")).toBe("mnt-net-nas\\x2dphotos");
  const place = smb({ readOnly: true });
  expect(unitOf(place)).toBe("mnt-net-nas.mount");
  const unit = mountUnit(place, owner, "/etc/hata/net/a1.cred");
  expect(unit).toContain("What=//nas.local/photos/2024\n");
  expect(unit).toContain("Where=/mnt/net/nas\n");
  expect(unit).toContain("Type=cifs\n");
  expect(unit).toContain("Options=credentials=/etc/hata/net/a1.cred,uid=1000,gid=1000,file_mode=0664,dir_mode=0775,iocharset=utf8,soft,echo_interval=15,ro\n");
  expect(unit).not.toContain("p w");
  expect(credentials(place)).toBe("username=me\npassword=p w\n");
  const nfs = cleanPlace({ kind: "nfs", name: "Media", host: "fd00::5", path: "/srv/media", port: 2049 }, null, [], "n", 0) as Place;
  expect(mountUnit(nfs, owner, "")).toContain("What=[fd00::5]:/srv/media\n");
  expect(mountUnit(nfs, owner, "")).toContain("Options=soft,timeo=100,retrans=2,port=2049\n");
});

test("rclone's places: a config section and a service with every argument quoted", () => {
  const sftp = cleanPlace({ kind: "sftp", name: "Box", host: "box.lan", user: "me", path: "/srv/my files" }, null, [], "s", 0) as Place;
  expect(unitOf(sftp)).toBe("hata-net-box.service");
  expect(rcloneSection(sftp, "OBSC", "/etc/hata/net-known-hosts")).toBe("[hata-box]\ntype = sftp\nhost = box.lan\nuser = me\nport = 22\nknown_hosts_file = /etc/hata/net-known-hosts\nshell_type = unix\nmd5sum_command = none\nsha1sum_command = none\npass = OBSC\n");
  const unit = rcloneUnit(sftp, owner, "/usr/bin/rclone", "/etc/hata/rclone.conf", "/var/cache/hata-rclone/box", "/usr/bin/fusermount3");
  expect(unit).toContain('ExecStart=/usr/bin/rclone mount "hata-box:/srv/my files" /mnt/net/box --config /etc/hata/rclone.conf');
  expect(unit).toContain("Type=notify\n");
  expect(quoteArg("50%$")).toBe('"50%%$$"');
  const ftp = cleanPlace({ kind: "ftp", name: "Old box", host: "10.0.0.9", tls: true }, null, [], "f", 0) as Place;
  expect(rcloneSection(ftp, "", "")).toBe("[hata-old-box]\ntype = ftp\nhost = 10.0.0.9\nuser = anonymous\nport = 21\nexplicit_tls = true\n");
  const dav = cleanPlace({ kind: "webdav", name: "Cloud", url: "https://dav.example.org/remote.php/dav/files/me", user: "me" }, null, [], "w", 0) as Place;
  expect(rcloneSection(dav, "X", "")).toContain("url = https://dav.example.org/remote.php/dav/files/me\nvendor = other\nuser = me\npass = X\n");
});

test("what the tools that look around print", () => {
  expect(parseSmbShares("Disk|photos|Family photos\nDisk|IPC$|\nPrinter|hp|\nDisk|Музика|\n")).toEqual(["photos", "Музика"]);
  expect(parseExports("Export list for nas:\n/srv/media 192.168.1.0/24\n/srv/backup *\n")).toEqual(["/srv/media", "/srv/backup"]);
});

test("servers found by multicast DNS: one per kind and host", () => {
  const question = parseQuery(browseQuery(["_smb._tcp", "_nfs._tcp"]))!;
  expect(question.questions.map((q) => q.name)).toEqual(["_smb._tcp.local", "_nfs._tcp.local"]);
  const answer = announcement("nas.local", [{ type: "_smb._tcp", port: 445 }, { type: "_nfs._tcp", port: 2049 }], "192.168.1.5")!;
  expect(foundServers(parseAnswer(answer))).toEqual([
    { kind: "nfs", name: "nas", host: "nas.local", address: "192.168.1.5", port: 2049 },
    { kind: "smb", name: "nas", host: "nas.local", address: "192.168.1.5", port: 445 },
  ]);
  expect(parseAnswer(browseQuery(["_smb._tcp"]))).toEqual([]);
});
