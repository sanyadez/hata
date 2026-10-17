import { expect, test } from "bun:test";
import { adiskTxt, cleanShares, isOurs, nameFor, nameLine, netbiosName, parseUsers, shareName, smbConf, UNIX_NAME_RE, unixName, userMap, writablePath, type Share } from "../src/smbconf";

test("shareName: letters of any alphabet, digits, spaces; nothing Samba reads as its own", () => {
  expect(shareName("  Media  ")).toBe("Media");
  expect(shareName("Фото   2026")).toBe("Фото 2026");
  expect(shareName("my.files-1_a")).toBe("my.files-1_a");
  for (const bad of ["", " ", "a/b", "a\\b", "[x]", "50%", "hidden$", "name.", ".hidden", "global", "Homes", "IPC$", "x".repeat(41), 5, null]) expect(shareName(bad)).toBeNull();
});

test("nameFor: the folder's own name, tidied, and never one that is taken", () => {
  expect(nameFor("/DATA/Media", [])).toBe("Media");
  expect(nameFor("/DATA/Media", ["media"])).toBe("Media 2");
  expect(nameFor("/DATA/Media", ["Media", "Media 2"])).toBe("Media 3");
  expect(nameFor("/DATA/.cache [old]%", [])).toBe("cache old");
  expect(nameFor("/mnt/Фото", [])).toBe("Фото");
  expect(nameFor("/mnt/$$$", [])).toBe("Shared");
  expect(nameFor("/mnt/global", [])).toBe("Shared");
  expect(shareName(nameFor("/mnt/" + "long name ".repeat(9), ["x"]))).not.toBeNull();
});

test("writablePath: what would change the meaning of Samba's file is refused", () => {
  expect(writablePath("/DATA/My Films (2026)")).toBe(true);
  for (const bad of ["DATA", "/DATA/%U", "/DATA/a\\", "/DATA/a\nguest ok = yes", "/DATA/a "]) expect(writablePath(bad)).toBe(false);
});

test("cleanShares: what is not a share is dropped, names and folders are unique", () => {
  expect(
    cleanShares([
      { name: "Media", path: "/DATA/Media", guest: "read", users: { a: "write", b: "read", c: "none", d: 1 } },
      { name: "media", path: "/DATA/Other" },
      { name: "Again", path: "/DATA/Media" },
      { name: "bad/name", path: "/DATA/x" },
      { name: "Docs", path: "/DATA/%U" },
      { name: "Docs", path: "/DATA/Docs", guest: true, users: [], extra: 1 },
      null,
      "x",
    ]),
  ).toEqual([
    { name: "Media", path: "/DATA/Media", guest: "read", users: { a: "write", b: "read" } },
    { name: "Docs", path: "/DATA/Docs", guest: "none", users: {} },
  ]);
  expect(cleanShares(undefined)).toEqual([]);
});

const ANNA = { id: "11111111-aaaa-4bbb-8ccc-000000000001", name: "anna" };
const TV = { id: "22222222-aaaa-4bbb-8ccc-000000000002", name: "TV" };
const share = (rest: Partial<Share>): Share => ({ name: "Media", path: "/DATA/Media", guest: "none", users: {}, ...rest });
const section = (conf: string, name: string) => conf.split("\n\n").find((part) => part.startsWith(`[${name}]`))!.split("\n").slice(1).map((line) => line.trim()).filter(Boolean);

test("unixName: a system account made from the user's id", () => {
  expect(unixName(ANNA.id)).toBe("hata-11111111");
  expect(UNIX_NAME_RE.test(unixName(crypto.randomUUID()))).toBe(true);
  expect(UNIX_NAME_RE.test("hata")).toBe(false);
});

test("smbConf: the whole of Samba's configuration, nothing on but what Hata offers", () => {
  const conf = smbConf([], [ANNA]);
  expect(isOurs(conf)).toBe(true);
  expect(isOurs("[global]\n   workgroup = HOME\n")).toBe(false);
  expect(section(conf, "global")).toContain("map to guest = Never");
  expect(section(conf, "global")).toContain("username map = /etc/samba/hata-users.map");
  expect(section(conf, "global")).toContain("load printers = no");
  expect(conf.match(/^\[/gm)).toEqual(["["]);
});

test("smbConf: who may open a folder and who may change it", () => {
  const conf = smbConf(
    [
      share({ name: "Named", users: { [ANNA.id]: "write", [TV.id]: "read", gone: "write" } }),
      share({ name: "Nobody", path: "/DATA/n" }),
      share({ name: "Look", path: "/DATA/l", guest: "read", users: { [ANNA.id]: "write", [TV.id]: "read" } }),
      share({ name: "Free for all", path: "/DATA/My Films", guest: "write", users: { [ANNA.id]: "read" } }),
    ],
    [ANNA, TV],
  );
  expect(section(conf, "global")).toContain("map to guest = Bad User");
  expect(section(conf, "Named")).toEqual(["path = /DATA/Media", "browseable = yes", "guest ok = no", "read only = yes", "valid users = hata-11111111 hata-22222222", "write list = hata-11111111", "force user = root", "inherit owner = yes", "inherit permissions = yes", "map archive = no"]);
  // a folder nobody is named for is closed, not open to everyone
  expect(section(conf, "Nobody")).toContain("available = no");
  expect(section(conf, "Nobody").some((line) => line.startsWith("valid users"))).toBe(false);
  // open to anyone to look at: those named for more still may change
  expect(section(conf, "Look")).toEqual(["path = /DATA/l", "browseable = yes", "guest ok = yes", "read only = yes", "write list = hata-11111111", "force user = root", "inherit owner = yes", "inherit permissions = yes", "map archive = no"]);
  expect(section(conf, "Free for all")).toEqual(["path = /DATA/My Films", "browseable = yes", "guest ok = yes", "read only = no", "force user = root", "inherit owner = yes", "inherit permissions = yes", "map archive = no"]);
});

test("userMap: the name typed in leads to the system account", () => {
  expect(userMap([ANNA, TV])).toEndWith("hata-11111111 = anna\nhata-22222222 = TV\n");
});

test("parseUsers: the names of pdbedit -L", () => {
  expect(parseUsers("hata-11111111:999:Hata: anna\noleksandr:1000:Oleksandr\n")).toEqual(["hata-11111111", "oleksandr"]);
  expect(parseUsers("")).toEqual([]);
});

test("the computer's name and who announces the folders are told to Samba", () => {
  expect(smbConf([], [])).not.toMatch(/netbios name|multicast dns/);
  const conf = smbConf([], [], { name: "hata", announced: true });
  expect(conf).toContain("   netbios name = HATA\n");
  expect(conf).toContain("   multicast dns register = no\n");
  expect(nameLine(conf)).toBe("netbios name = HATA");
  expect(nameLine(smbConf([], []))).toBe("");
  expect(nameLine(null)).toBe("");
  // fifteen characters, and nothing a name of that kind cannot hold
  expect(netbiosName("my-home-server-in-the-attic")).toBe("MY-HOME-SERVER-");
  expect(netbiosName("дім")).toBe("");
});

test("Time Machine: the share is a backup destination for Macs, with its limit, and Macs are told of it", () => {
  const shares = cleanShares([
    { name: "Backups", path: "/DATA/Backups/Mac", guest: "none", users: { a1b2c3d4: "write" }, timeMachine: { limit: 500 } },
    { name: "Media", path: "/DATA/Media", guest: "read", users: {}, timeMachine: { limit: -1 } },
    { name: "Old Mac", path: "/mnt/tm", guest: "none", users: { a1b2c3d4: "write" }, timeMachine: {} },
  ]);
  expect(shares.map((share) => share.timeMachine)).toEqual([{ limit: 500 }, undefined, { limit: 0 }]);
  const section = (conf: string, name: string) => conf.split(`[${name}]`)[1]!.split("\n[")[0]!;
  const conf = smbConf([...shares, { name: "Stick", path: "/mnt/stick", guest: "none", users: { a1b2c3d4: "write" } }], [{ id: "a1b2c3d4", name: "olena" }], { name: "hata", announced: true, bare: ["/mnt/stick"] });
  // Apple's extensions for every folder of the server, or a Mac goes wrong
  expect(section(conf, "global")).toContain("   vfs objects = catia fruit streams_xattr");
  expect(section(conf, "Backups")).toContain("   fruit:time machine = yes");
  expect(section(conf, "Backups")).toContain("   fruit:time machine max size = 500G");
  expect(section(conf, "Old Mac")).not.toContain("max size");
  expect(section(conf, "Media")).not.toContain("time machine");
  // a FAT or exFAT disk keeps no streams: it gets the extensions without them
  expect(section(conf, "Stick")).toContain("   vfs objects = catia fruit\n");
  expect(section(conf, "Backups")).not.toContain("vfs objects");
  // without Time Machine nothing of it is there
  expect(smbConf([shares[1]!], [], { name: "hata", announced: true, bare: ["/DATA/Media"] })).not.toContain("fruit");
  expect(adiskTxt(shares)).toEqual(["sys=waMa=0,adVF=0x100", "dk0=adVN=Backups,adVF=0x82", "dk1=adVN=Old Mac,adVF=0x82"]);
  expect(adiskTxt([shares[1]!])).toBeNull();
});

test("users kept out of the network folders are turned away by name, guests' folders too", () => {
  const share = { name: "Media", path: "/DATA/Media", guest: "read" as const, users: { a1b2c3d4: "write" as const, e5f6a7b8: "read" as const } };
  // the one kept out is not among the accounts, so not on the lists of the folder
  const conf = smbConf([share], [{ id: "a1b2c3d4", name: "olena" }], { name: "hata", announced: true, denied: ["hata-e5f6a7b8"] });
  expect(conf).toContain("   invalid users = hata-e5f6a7b8\n");
  expect(conf).toContain("   write list = hata-a1b2c3d4\n");
  expect(conf.split("e5f6a7b8").length).toBe(2);
  expect(smbConf([share], [], { name: "hata", announced: true, denied: [] })).not.toContain("invalid users");
});
